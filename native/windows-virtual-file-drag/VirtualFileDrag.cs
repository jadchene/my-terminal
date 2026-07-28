using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace MyTerminal.VirtualFileDrag
{
    internal static class Program
    {
        private const uint DropEffectCopy = 1;

        [STAThread]
        private static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length != 1 || !File.Exists(args[0]))
            {
                WriteProtocolLine("ERROR\tmanifest-not-found");
                return 2;
            }

            DragManifest manifest;
            try
            {
                string json = File.ReadAllText(args[0], Encoding.UTF8);
                manifest = new JavaScriptSerializer().Deserialize<DragManifest>(json);
                bool hasVirtualFiles = manifest != null && manifest.Items != null && manifest.Items.Count > 0;
                bool hasLocalPaths = manifest != null && manifest.LocalPaths != null && manifest.LocalPaths.Count > 0;
                if (!hasVirtualFiles && !hasLocalPaths)
                {
                    throw new InvalidDataException("The drag manifest is empty.");
                }
            }
            catch (Exception error)
            {
                WriteProtocolLine("ERROR\t" + Encode(error.Message));
                return 3;
            }

            int initializeResult = NativeMethods.OleInitialize(IntPtr.Zero);
            if (initializeResult < 0)
            {
                WriteProtocolLine("ERROR\t" + Encode("OleInitialize failed: 0x" + initializeResult.ToString("X8")));
                return 4;
            }

            TransferProtocol protocol = null;
            VirtualFileDataObject dataObject = null;
            MouseInputRelay mouseRelay = null;
            try
            {
                long sourceWindowValue;
                IntPtr sourceWindow = long.TryParse(manifest.SourceWindowHandle, out sourceWindowValue)
                    ? new IntPtr(sourceWindowValue)
                    : IntPtr.Zero;
                mouseRelay = new MouseInputRelay(sourceWindow);
                protocol = new TransferProtocol(manifest.TempRoot, mouseRelay);
                protocol.Start();
                dataObject = new VirtualFileDataObject(manifest.Items, manifest.LocalPaths, protocol);
                mouseRelay.Start();
                uint effect;
                WriteProtocolLine("DRAGGING");
                int result = NativeMethods.DoDragDrop(dataObject, new DropSource(mouseRelay), DropEffectCopy, out effect);
                WriteProtocolLine("END\t" + result + "\t" + effect);
                return result == NativeMethods.DragDropSCancel || result == NativeMethods.DragDropSDrop ? 0 : 5;
            }
            catch (Exception error)
            {
                WriteProtocolLine("ERROR\t" + Encode(error.Message));
                return 6;
            }
            finally
            {
                if (dataObject != null)
                {
                    dataObject.Dispose();
                }
                if (mouseRelay != null)
                {
                    mouseRelay.Dispose();
                }
                if (protocol != null)
                {
                    protocol.Dispose();
                }
                NativeMethods.OleUninitialize();
            }
        }

        internal static void WriteProtocolLine(string line)
        {
            lock (Console.Out)
            {
                Console.Out.WriteLine(line);
                Console.Out.Flush();
            }
        }

        internal static string Encode(string value)
        {
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
        }
    }

    internal sealed class MouseInputRelay : IDisposable
    {
        private readonly uint dragThreadId;
        private readonly Thread relayThread;
        private readonly IntPtr sourceWindow;
        private volatile bool stopped;
        private volatile bool returnedToSource;
        private bool hasLeftSource;

        public MouseInputRelay(IntPtr sourceWindowValue)
        {
            sourceWindow = sourceWindowValue;
            NativeMessage ignored;
            NativeMethods.PeekMessage(out ignored, IntPtr.Zero, 0, 0, 0);
            dragThreadId = NativeMethods.GetCurrentThreadId();
            relayThread = new Thread(RelayMouseState);
            relayThread.IsBackground = true;
            relayThread.Name = "my-terminal-drag-mouse-relay";
        }

        public void Start()
        {
            relayThread.Start();
        }

        public bool ReturnedToSource
        {
            get { return returnedToSource; }
        }

        private void RelayMouseState()
        {
            while (!stopped)
            {
                bool leftDown = (NativeMethods.GetAsyncKeyState(NativeMethods.VirtualKeyLeftButton) & 0x8000) != 0;
                NativePoint point;
                NativeMethods.GetCursorPos(out point);
                if (sourceWindow != IntPtr.Zero)
                {
                    IntPtr hoveredWindow = NativeMethods.WindowFromPoint(point);
                    IntPtr hoveredRoot = hoveredWindow == IntPtr.Zero
                        ? IntPtr.Zero
                        : NativeMethods.GetAncestor(hoveredWindow, NativeMethods.GetAncestorRoot);
                    if (hoveredRoot != sourceWindow)
                    {
                        hasLeftSource = true;
                    }
                    else if (hasLeftSource && !returnedToSource)
                    {
                        returnedToSource = true;
                        Program.WriteProtocolLine("RETURNED");
                    }
                }
                uint message = leftDown ? NativeMethods.WindowMessageMouseMove : NativeMethods.WindowMessageLeftButtonUp;
                UIntPtr keyState = leftDown ? new UIntPtr(NativeMethods.MouseKeyLeft) : UIntPtr.Zero;
                int coordinates = (point.x & 0xffff) | ((point.y & 0xffff) << 16);
                NativeMethods.PostThreadMessage(dragThreadId, message, keyState, new IntPtr(coordinates));
                if (!leftDown) return;
                Thread.Sleep(12);
            }
        }

        public void Dispose()
        {
            stopped = true;
        }
    }

    internal sealed class DragManifest
    {
        public string TempRoot { get; set; }
        public string SourceWindowHandle { get; set; }
        public List<DragItem> Items { get; set; }
        public List<string> LocalPaths { get; set; }
    }

    internal sealed class DragItem
    {
        public int Index { get; set; }
        public string Name { get; set; }
        public bool IsDirectory { get; set; }
        public long Size { get; set; }
    }

    internal sealed class TransferProtocol : IDisposable
    {
        private sealed class PendingTransfer
        {
            public readonly ManualResetEvent Completed = new ManualResetEvent(false);
            public string Error;
        }

        private readonly string tempRoot;
        private readonly MouseInputRelay mouseRelay;
        private readonly Dictionary<int, PendingTransfer> pending = new Dictionary<int, PendingTransfer>();
        private readonly object sync = new object();
        private readonly ManualResetEvent localPathsReady = new ManualResetEvent(false);
        private Thread readerThread;
        private bool disposed;
        private string localPathsError;

        public TransferProtocol(string tempRootValue, MouseInputRelay relay)
        {
            if (string.IsNullOrWhiteSpace(tempRootValue))
            {
                throw new InvalidDataException("A transfer temp directory is required.");
            }
            tempRoot = Path.GetFullPath(tempRootValue);
            mouseRelay = relay;
            Directory.CreateDirectory(tempRoot);
        }

        public void Start()
        {
            readerThread = new Thread(ReadResponses);
            readerThread.IsBackground = true;
            readerThread.Name = "my-terminal-drag-protocol";
            readerThread.Start();
        }

        public string PrepareItem(int index)
        {
            string localPath = Path.Combine(tempRoot, index.ToString() + ".data");
            PendingTransfer transfer = new PendingTransfer();
            lock (sync)
            {
                if (disposed)
                {
                    throw new ObjectDisposedException("TransferProtocol");
                }
                pending[index] = transfer;
            }

            Program.WriteProtocolLine("REQUEST\t" + index);
            if (!transfer.Completed.WaitOne(TimeSpan.FromHours(12)))
            {
                lock (sync)
                {
                    pending.Remove(index);
                }
                throw new TimeoutException("Timed out while waiting for SFTP content.");
            }

            lock (sync)
            {
                pending.Remove(index);
            }
            transfer.Completed.Dispose();
            if (!string.IsNullOrEmpty(transfer.Error))
            {
                throw new IOException(transfer.Error);
            }
            return localPath;
        }

        public void WaitForLocalPaths()
        {
            while ((NativeMethods.GetAsyncKeyState(NativeMethods.VirtualKeyLeftButton) & 0x8000) != 0)
            {
                if (mouseRelay.ReturnedToSource)
                {
                    throw new COMException("The directory drag returned to the source window.", NativeMethods.ErrorCancelled);
                }
                Thread.Sleep(12);
            }
            if (mouseRelay.ReturnedToSource)
            {
                throw new COMException("The directory drag returned to the source window.", NativeMethods.ErrorCancelled);
            }
            Program.WriteProtocolLine("REQUEST_LOCAL");
            if (!localPathsReady.WaitOne(TimeSpan.FromHours(12)))
            {
                throw new TimeoutException("Timed out while preparing the dragged directory.");
            }
            if (!string.IsNullOrEmpty(localPathsError))
            {
                throw new IOException(localPathsError);
            }
        }

        private void ReadResponses()
        {
            try
            {
                string line;
                while (!disposed && (line = Console.In.ReadLine()) != null)
                {
                    if (line == "LOCAL_READY")
                    {
                        localPathsReady.Set();
                        continue;
                    }
                    if (line.StartsWith("LOCAL_ERROR\t", StringComparison.Ordinal))
                    {
                        localPathsError = Decode(line.Substring("LOCAL_ERROR\t".Length));
                        localPathsReady.Set();
                        continue;
                    }
                    string[] parts = line.Split(new[] { '\t' }, 3);
                    if (parts.Length < 2) continue;
                    int index;
                    if (!int.TryParse(parts[1], out index)) continue;
                    PendingTransfer transfer;
                    lock (sync)
                    {
                        if (!pending.TryGetValue(index, out transfer)) continue;
                    }
                    if (parts[0] == "ERROR")
                    {
                        transfer.Error = parts.Length >= 3 ? Decode(parts[2]) : "SFTP download failed.";
                    }
                    if (parts[0] == "READY" || parts[0] == "ERROR")
                    {
                        transfer.Completed.Set();
                    }
                }
            }
            catch (Exception error)
            {
                FailAll(error.Message);
            }
            finally
            {
                FailAll("The Electron transfer process ended.");
                if (!disposed && string.IsNullOrEmpty(localPathsError))
                {
                    localPathsError = "The Electron transfer process ended.";
                }
                localPathsReady.Set();
            }
        }

        private static string Decode(string value)
        {
            try
            {
                return Encoding.UTF8.GetString(Convert.FromBase64String(value));
            }
            catch
            {
                return value;
            }
        }

        private void FailAll(string message)
        {
            lock (sync)
            {
                foreach (PendingTransfer transfer in pending.Values)
                {
                    transfer.Error = message;
                    transfer.Completed.Set();
                }
            }
        }

        public void Dispose()
        {
            lock (sync)
            {
                if (disposed) return;
                disposed = true;
                foreach (PendingTransfer transfer in pending.Values)
                {
                    transfer.Error = "The drag operation was cancelled.";
                    transfer.Completed.Set();
                }
                localPathsError = "The drag operation was cancelled.";
                localPathsReady.Set();
            }
        }
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    internal sealed class VirtualFileDataObject : IDataObject, IDisposable
    {
        private const int S_OK = 0;
        private const int E_NOTIMPL = unchecked((int)0x80004001);
        private const int DV_E_FORMATETC = unchecked((int)0x80040064);
        private const int DV_E_LINDEX = unchecked((int)0x80040068);
        private const uint FdAttributes = 0x00000004;
        private const uint FdFileSize = 0x00000040;
        private const uint FdProgressUi = 0x00004000;
        private const uint FdUnicode = 0x80000000;
        private const uint FileAttributeDirectory = 0x00000010;
        private const uint FileAttributeNormal = 0x00000080;
        private const short FileDropFormat = 15;

        private readonly List<DragItem> items;
        private readonly List<string> localPaths;
        private readonly TransferProtocol protocol;
        private readonly short fileGroupDescriptorFormat;
        private readonly short fileContentsFormat;
        private readonly short preferredDropEffectFormat;
        private readonly List<IStream> openStreams = new List<IStream>();

        public VirtualFileDataObject(List<DragItem> manifestItems, List<string> manifestLocalPaths, TransferProtocol transferProtocol)
        {
            items = manifestItems ?? new List<DragItem>();
            localPaths = manifestLocalPaths ?? new List<string>();
            protocol = transferProtocol;
            fileGroupDescriptorFormat = unchecked((short)NativeMethods.RegisterClipboardFormat("FileGroupDescriptorW"));
            fileContentsFormat = unchecked((short)NativeMethods.RegisterClipboardFormat("FileContents"));
            preferredDropEffectFormat = unchecked((short)NativeMethods.RegisterClipboardFormat("Preferred DropEffect"));
        }

        public void GetData(ref FORMATETC format, out STGMEDIUM medium)
        {
            if (localPaths.Count > 0 && format.cfFormat == FileDropFormat && Supports(format, TYMED.TYMED_HGLOBAL))
            {
                protocol.WaitForLocalPaths();
                medium = CreateFileDrop();
                return;
            }
            if (format.cfFormat == fileGroupDescriptorFormat && Supports(format, TYMED.TYMED_HGLOBAL))
            {
                medium = CreateFileGroupDescriptor();
                return;
            }
            if (format.cfFormat == preferredDropEffectFormat && Supports(format, TYMED.TYMED_HGLOBAL))
            {
                medium = CreatePreferredDropEffect();
                return;
            }
            if (format.cfFormat == fileContentsFormat && Supports(format, TYMED.TYMED_ISTREAM))
            {
                if (format.lindex < 0 || format.lindex >= items.Count)
                {
                    throw new COMException("Invalid virtual file index.", DV_E_LINDEX);
                }
                DragItem item = items[format.lindex];
                if (item.IsDirectory)
                {
                    throw new COMException("Directories do not expose file contents.", DV_E_LINDEX);
                }
                string localPath = protocol.PrepareItem(item.Index);
                IStream stream;
                int createResult = NativeMethods.SHCreateStreamOnFileEx(
                    localPath,
                    NativeMethods.StorageModeRead | NativeMethods.StorageModeShareDenyWrite,
                    FileAttributeNormal,
                    false,
                    null,
                    out stream);
                if (createResult < 0 || stream == null)
                {
                    throw new COMException("Windows could not open the downloaded drag content.", createResult);
                }
                openStreams.Add(stream);
                medium = new STGMEDIUM
                {
                    tymed = TYMED.TYMED_ISTREAM,
                    unionmember = Marshal.GetComInterfaceForObject(stream, typeof(IStream)),
                    pUnkForRelease = null,
                };
                return;
            }
            throw new COMException("Unsupported clipboard format.", DV_E_FORMATETC);
        }

        public void GetDataHere(ref FORMATETC format, ref STGMEDIUM medium)
        {
            throw new COMException("GetDataHere is not supported.", E_NOTIMPL);
        }

        public int QueryGetData(ref FORMATETC format)
        {
            if (format.dwAspect != DVASPECT.DVASPECT_CONTENT) return DV_E_FORMATETC;
            if (localPaths.Count > 0)
            {
                if (format.cfFormat == FileDropFormat && Supports(format, TYMED.TYMED_HGLOBAL)) return S_OK;
                if (format.cfFormat == preferredDropEffectFormat && Supports(format, TYMED.TYMED_HGLOBAL)) return S_OK;
                return DV_E_FORMATETC;
            }
            if (format.cfFormat == fileGroupDescriptorFormat && Supports(format, TYMED.TYMED_HGLOBAL)) return S_OK;
            if (format.cfFormat == preferredDropEffectFormat && Supports(format, TYMED.TYMED_HGLOBAL)) return S_OK;
            if (format.cfFormat == fileContentsFormat && Supports(format, TYMED.TYMED_ISTREAM))
            {
                if (format.lindex == -1) return S_OK;
                return format.lindex >= 0 && format.lindex < items.Count && !items[format.lindex].IsDirectory
                    ? S_OK
                    : DV_E_LINDEX;
            }
            return DV_E_FORMATETC;
        }

        public int GetCanonicalFormatEtc(ref FORMATETC formatIn, out FORMATETC formatOut)
        {
            formatOut = formatIn;
            formatOut.ptd = IntPtr.Zero;
            return NativeMethods.DataSFormatEtc;
        }

        public void SetData(ref FORMATETC formatIn, ref STGMEDIUM medium, bool release)
        {
            // Shell drop targets use SetData to report performed/logical effects and
            // update drag descriptions. These are feedback formats, not file content.
            if (release)
            {
                NativeMethods.ReleaseStgMedium(ref medium);
                medium.tymed = TYMED.TYMED_NULL;
                medium.unionmember = IntPtr.Zero;
                medium.pUnkForRelease = null;
            }
        }

        public IEnumFORMATETC EnumFormatEtc(DATADIR direction)
        {
            if (direction != DATADIR.DATADIR_GET)
            {
                throw new COMException("Only DATADIR_GET is supported.", E_NOTIMPL);
            }
            FORMATETC[] formats = localPaths.Count > 0
                ? new[]
                {
                    CreateFormat(FileDropFormat, -1, TYMED.TYMED_HGLOBAL),
                    CreateFormat(preferredDropEffectFormat, -1, TYMED.TYMED_HGLOBAL),
                }
                : new[]
                {
                    CreateFormat(fileGroupDescriptorFormat, -1, TYMED.TYMED_HGLOBAL),
                    CreateFormat(fileContentsFormat, -1, TYMED.TYMED_ISTREAM),
                    CreateFormat(preferredDropEffectFormat, -1, TYMED.TYMED_HGLOBAL),
                };
            return new FormatEnumerator(formats);
        }

        public int DAdvise(ref FORMATETC pFormatetc, ADVF advf, IAdviseSink adviseSink, out int connection)
        {
            connection = 0;
            return NativeMethods.OleEAdvisenotSupported;
        }

        public void DUnadvise(int connection)
        {
            throw new COMException("Advisory connections are not supported.", NativeMethods.OleEAdvisenotSupported);
        }

        public int EnumDAdvise(out IEnumSTATDATA enumAdvise)
        {
            enumAdvise = null;
            return NativeMethods.OleEAdvisenotSupported;
        }

        private static bool Supports(FORMATETC format, TYMED tymed)
        {
            return format.dwAspect == DVASPECT.DVASPECT_CONTENT && (format.tymed & tymed) != 0;
        }

        private static FORMATETC CreateFormat(short format, int index, TYMED tymed)
        {
            return new FORMATETC
            {
                cfFormat = format,
                dwAspect = DVASPECT.DVASPECT_CONTENT,
                lindex = index,
                ptd = IntPtr.Zero,
                tymed = tymed,
            };
        }

        private STGMEDIUM CreateFileGroupDescriptor()
        {
            int descriptorSize = Marshal.SizeOf(typeof(FileDescriptorW));
            int totalSize = sizeof(uint) + descriptorSize * items.Count;
            IntPtr handle = NativeMethods.GlobalAlloc(NativeMethods.GMemMoveable | NativeMethods.GMemZeroInit, new UIntPtr((uint)totalSize));
            if (handle == IntPtr.Zero) throw new OutOfMemoryException();
            IntPtr memory = NativeMethods.GlobalLock(handle);
            if (memory == IntPtr.Zero)
            {
                NativeMethods.GlobalFree(handle);
                throw new OutOfMemoryException();
            }
            try
            {
                Marshal.WriteInt32(memory, items.Count);
                for (int index = 0; index < items.Count; index++)
                {
                    DragItem item = items[index];
                    ulong size = item.Size < 0 ? 0UL : (ulong)item.Size;
                    FileDescriptorW descriptor = new FileDescriptorW
                    {
                        dwFlags = FdAttributes | FdProgressUi | FdUnicode | (item.IsDirectory ? 0U : FdFileSize),
                        dwFileAttributes = item.IsDirectory ? FileAttributeDirectory : FileAttributeNormal,
                        nFileSizeHigh = (uint)(size >> 32),
                        nFileSizeLow = (uint)(size & 0xffffffff),
                        cFileName = item.Name ?? "download",
                    };
                    IntPtr target = IntPtr.Add(memory, sizeof(uint) + descriptorSize * index);
                    Marshal.StructureToPtr(descriptor, target, false);
                }
            }
            finally
            {
                NativeMethods.GlobalUnlock(handle);
            }
            return new STGMEDIUM { tymed = TYMED.TYMED_HGLOBAL, unionmember = handle, pUnkForRelease = null };
        }

        private STGMEDIUM CreateFileDrop()
        {
            foreach (string localPath in localPaths)
            {
                if (!Path.IsPathRooted(localPath) || !File.Exists(localPath) && !Directory.Exists(localPath))
                {
                    throw new FileNotFoundException("A staged drag path is missing.", localPath);
                }
            }
            byte[] pathBytes = Encoding.Unicode.GetBytes(string.Join("\0", localPaths.ToArray()) + "\0\0");
            const int dropFilesSize = 20;
            int totalSize = dropFilesSize + pathBytes.Length;
            IntPtr handle = NativeMethods.GlobalAlloc(NativeMethods.GMemMoveable | NativeMethods.GMemZeroInit, new UIntPtr((uint)totalSize));
            if (handle == IntPtr.Zero) throw new OutOfMemoryException();
            IntPtr memory = NativeMethods.GlobalLock(handle);
            if (memory == IntPtr.Zero)
            {
                NativeMethods.GlobalFree(handle);
                throw new OutOfMemoryException();
            }
            try
            {
                Marshal.WriteInt32(memory, 0, dropFilesSize);
                Marshal.WriteInt32(memory, 4, 0);
                Marshal.WriteInt32(memory, 8, 0);
                Marshal.WriteInt32(memory, 12, 0);
                Marshal.WriteInt32(memory, 16, 1);
                Marshal.Copy(pathBytes, 0, IntPtr.Add(memory, dropFilesSize), pathBytes.Length);
            }
            finally
            {
                NativeMethods.GlobalUnlock(handle);
            }
            return new STGMEDIUM { tymed = TYMED.TYMED_HGLOBAL, unionmember = handle, pUnkForRelease = null };
        }

        private static STGMEDIUM CreatePreferredDropEffect()
        {
            IntPtr handle = NativeMethods.GlobalAlloc(NativeMethods.GMemMoveable | NativeMethods.GMemZeroInit, new UIntPtr(sizeof(uint)));
            if (handle == IntPtr.Zero) throw new OutOfMemoryException();
            IntPtr memory = NativeMethods.GlobalLock(handle);
            if (memory == IntPtr.Zero)
            {
                NativeMethods.GlobalFree(handle);
                throw new OutOfMemoryException();
            }
            Marshal.WriteInt32(memory, 1);
            NativeMethods.GlobalUnlock(handle);
            return new STGMEDIUM { tymed = TYMED.TYMED_HGLOBAL, unionmember = handle, pUnkForRelease = null };
        }

        public void Dispose()
        {
            foreach (IStream stream in openStreams)
            {
                if (Marshal.IsComObject(stream)) Marshal.FinalReleaseComObject(stream);
            }
            openStreams.Clear();
        }

    }

    internal sealed class FormatEnumerator : IEnumFORMATETC
    {
        private readonly FORMATETC[] formats;
        private int index;

        public FormatEnumerator(FORMATETC[] source)
        {
            formats = source;
        }

        public int Next(int count, FORMATETC[] result, int[] fetched)
        {
            int copied = 0;
            while (copied < count && index < formats.Length)
            {
                result[copied] = formats[index];
                copied++;
                index++;
            }
            if (fetched != null && fetched.Length > 0) fetched[0] = copied;
            return copied == count ? 0 : 1;
        }

        public int Skip(int count)
        {
            index = Math.Min(formats.Length, index + count);
            return index < formats.Length ? 0 : 1;
        }

        public int Reset()
        {
            index = 0;
            return 0;
        }

        public void Clone(out IEnumFORMATETC clone)
        {
            FormatEnumerator next = new FormatEnumerator(formats);
            next.index = index;
            clone = next;
        }
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    internal sealed class DropSource : IDropSource
    {
        private readonly MouseInputRelay mouseRelay;

        public DropSource(MouseInputRelay relay)
        {
            mouseRelay = relay;
        }

        public int QueryContinueDrag(bool escapePressed, uint keyState)
        {
            if (escapePressed || mouseRelay.ReturnedToSource) return NativeMethods.DragDropSCancel;
            if ((keyState & NativeMethods.MouseKeyLeft) == 0) return NativeMethods.DragDropSDrop;
            return 0;
        }

        public int GiveFeedback(uint effect)
        {
            return NativeMethods.DragDropSUseDefaultCursors;
        }
    }

    [ComImport]
    [Guid("00000121-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDropSource
    {
        [PreserveSig]
        int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)] bool escapePressed, uint keyState);

        [PreserveSig]
        int GiveFeedback(uint effect);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SizeL
    {
        public int cx;
        public int cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PointL
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativePoint
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeMessage
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public NativePoint point;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 4)]
    internal struct FileDescriptorW
    {
        public uint dwFlags;
        public Guid clsid;
        public SizeL sizel;
        public PointL pointl;
        public uint dwFileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
        public uint nFileSizeHigh;
        public uint nFileSizeLow;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string cFileName;
    }

    internal static class NativeMethods
    {
        internal const int DragDropSDrop = 0x00040100;
        internal const int DragDropSCancel = 0x00040101;
        internal const int DragDropSUseDefaultCursors = 0x00040102;
        internal const int DataSFormatEtc = 0x00040130;
        internal const int OleEAdvisenotSupported = unchecked((int)0x80040003);
        internal const int ErrorCancelled = unchecked((int)0x800704C7);
        internal const uint MouseKeyLeft = 0x0001;
        internal const int VirtualKeyLeftButton = 0x01;
        internal const uint WindowMessageMouseMove = 0x0200;
        internal const uint WindowMessageLeftButtonUp = 0x0202;
        internal const uint GMemMoveable = 0x0002;
        internal const uint GMemZeroInit = 0x0040;
        internal const uint StorageModeRead = 0x00000000;
        internal const uint StorageModeShareDenyWrite = 0x00000020;
        internal const uint GetAncestorRoot = 2;

        [DllImport("ole32.dll")]
        internal static extern int OleInitialize(IntPtr reserved);

        [DllImport("ole32.dll")]
        internal static extern void OleUninitialize();

        [DllImport("ole32.dll")]
        internal static extern void ReleaseStgMedium(ref STGMEDIUM medium);

        [DllImport("ole32.dll")]
        internal static extern int DoDragDrop(
            [In, MarshalAs(UnmanagedType.Interface)] IDataObject dataObject,
            [In, MarshalAs(UnmanagedType.Interface)] IDropSource dropSource,
            uint allowedEffects,
            out uint effect);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern uint RegisterClipboardFormat(string format);

        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
        internal static extern int SHCreateStreamOnFileEx(
            string fileName,
            uint mode,
            uint attributes,
            [MarshalAs(UnmanagedType.Bool)] bool create,
            IStream template,
            out IStream stream);

        [DllImport("kernel32.dll")]
        internal static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        internal static extern short GetAsyncKeyState(int virtualKey);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetCursorPos(out NativePoint point);

        [DllImport("user32.dll")]
        internal static extern IntPtr WindowFromPoint(NativePoint point);

        [DllImport("user32.dll")]
        internal static extern IntPtr GetAncestor(IntPtr window, uint flags);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool PeekMessage(out NativeMessage message, IntPtr window, uint min, uint max, uint remove);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr GlobalLock(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GlobalUnlock(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr GlobalFree(IntPtr handle);
    }
}
