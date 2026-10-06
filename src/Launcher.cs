// Built locally with Windows .NET Framework; no service, task or auto-start entry.
// The job owns only this launcher's children; the user's normal browser is untouched.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Windows.Forms;

internal static class Launcher
{
    static readonly string Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
    static readonly string Game = Directory.GetParent(Root).FullName;
    static readonly string Run = Path.Combine(Root, "runtime-data");
    static readonly string Title = "Stronghold Protocol Trainer | 卫戍协议本地修改器";

    [STAThread]
    static int Main(string[] args)
    {
        bool stopping = Array.IndexOf(args, "--stop") >= 0;
        string key = Common.Key(Root);
        using (var mutex = new Mutex(false, Common.MutexName(Root)))
        using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\StrongholdTools-Stop-" + key))
        using (var focus = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\StrongholdTools-Focus-" + key))
        {
            bool owns = false;
            try
            {
                if (stopping) stop.Set();
                try { owns = mutex.WaitOne(stopping ? 20000 : 0); }
                catch (AbandonedMutexException) { owns = true; }
                if (!owns)
                {
                    if (!stopping) { focus.Set(); return 0; }
                    throw new Exception("关闭仍未完成，请稍后再次双击“关闭并清理”。");
                }
                Common.NoLink(Root);
                if (stopping) { CleanRuntime(); return 0; }
                if (File.Exists(Path.Combine(Root, "disabled"))) throw new Exception("扩展已停用。请在安装器中点击“安装 / 启用”。");
                Common.VerifyGame(Game);
                stop.Reset();
                CleanRuntime(); // Also recovers temporary files after power loss or a forced exit.
                RunGame(stop, focus);
                return 0;
            }
            catch (Exception e)
            {
                MessageBox.Show(e.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally { if (owns) mutex.ReleaseMutex(); }
        }
    }

    static string BrowserPath()
    {
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google\\Chrome\\Application\\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe")
        };
        foreach (string p in candidates) if (File.Exists(p)) return p;
        throw new Exception("找不到 Chrome 或 Edge。请安装其中一个浏览器后再启动。");
    }

    static void RunGame(EventWaitHandle stop, EventWaitHandle focus)
    {
        string node = Common.FindNode(Game);
        string browser = BrowserPath();
        Directory.CreateDirectory(Path.Combine(Run, "temp"));
        // Inherited only by these dedicated processes, never written to system environment.
        Environment.SetEnvironmentVariable("TEMP", Path.Combine(Run, "temp"));
        Environment.SetEnvironmentVariable("TMP", Path.Combine(Run, "temp"));
        Environment.SetEnvironmentVariable("NODE_COMPILE_CACHE", null);
        Environment.SetEnvironmentVariable("NODE_OPTIONS", null);
        Environment.SetEnvironmentVariable("CHROME_LOG_FILE", Path.Combine(Run, "browser.log"));
        Environment.SetEnvironmentVariable("SP_COMBAT", "client");
        Environment.SetEnvironmentVariable("SP_VERIFY", "off");
        Environment.SetEnvironmentVariable("DEBUG", null);
        Environment.SetEnvironmentVariable("SP_GAME_ROOT", null);
        Process server = null, window = null;
        string failure = null;
        try
        {
            using (var job = new ChildJob())
            {
                try
                {
                    server = job.Start(node, Quote(Path.Combine(Root, "server.mjs")), Game, true);
                    string ready = Path.Combine(Run, "ready");
                    var wait = Stopwatch.StartNew();
                    while (!File.Exists(ready))
                    {
                        if (stop.WaitOne(100)) return;
                        if (server.HasExited || wait.ElapsedMilliseconds > 30000)
                        {
                            string error = Path.Combine(Run, "error.txt");
                            throw new Exception(File.Exists(error) ? File.ReadAllText(error) : "本地服务未能启动（30 秒）。请检查游戏文件是否完整。");
                        }
                    }
                    int port = Int32.Parse(File.ReadAllText(ready));
                    if (port < 3000 || port > 3010) throw new Exception("启动端口无效。");
                    string url = "http://127.0.0.1:" + port;
                    string profile = Path.Combine(Run, "browser-profile");
                    string browserArgs = "--user-data-dir=" + Quote(profile)
                        + " --disk-cache-dir=" + Quote(Path.Combine(Run, "cache"))
                        + " --crash-dumps-dir=" + Quote(Path.Combine(Run, "crashes"))
                        + " --no-first-run --no-default-browser-check --disable-background-mode"
                        + " --disable-background-networking --disable-component-update --disable-sync"
                        + " --disable-breakpad --disable-crash-reporter --disable-gpu-shader-disk-cache"
                        + " --disable-features=ChromeWhatsNewUI --password-store=basic"
                        + " --window-size=1440,960 --app=" + url;
                    // A separate profile is discarded in full; no normal-browser state is reused.
                    window = job.Start(browser, browserArgs, Root, false);
                    File.WriteAllText(Path.Combine(Run, "session.txt"), "url=" + url + "\r\nlauncher=" + Process.GetCurrentProcess().Id + "\r\nserver=" + server.Id + "\r\nbrowser=" + window.Id);
                    while (!stop.WaitOne(250))
                    {
                        if (window.HasExited) break;
                        if (server.HasExited) throw new Exception("游戏服务意外退出，窗口将关闭并清理。请重新启动。");
                        if (focus.WaitOne(0))
                        {
                            window.Refresh();
                            IntPtr handle = window.MainWindowHandle;
                            if (handle != IntPtr.Zero) { ShowWindow(handle, 9); SetForegroundWindow(handle); }
                        }
                    }
                }
                finally
                {
                    // Graceful server close first; the Job Object is the fallback for hung children.
                    if (Directory.Exists(Run)) File.WriteAllText(Path.Combine(Run, "stop"), "stop");
                    if (window != null && !window.HasExited)
                    {
                        try { window.CloseMainWindow(); window.WaitForExit(2500); } catch { }
                    }
                    if (server != null && !server.HasExited) server.WaitForExit(5000);
                }
            } // KILL_ON_JOB_CLOSE also terminates all browser subprocesses.
        }
        catch (Exception e) { failure = e.Message; }
        finally
        {
            if (window != null) { try { window.WaitForExit(3000); } catch { } window.Dispose(); }
            if (server != null) { try { server.WaitForExit(3000); } catch { } server.Dispose(); }
            try { CleanRuntime(); }
            catch (Exception e) { failure = (failure == null ? "" : failure + "\r\n\r\n") + e.Message; }
        }
        if (failure != null) throw new Exception(failure);
    }

    static void CleanRuntime()
    {
        string full = Path.GetFullPath(Run);
        if (!String.Equals(full, Path.Combine(Root, "runtime-data"), StringComparison.OrdinalIgnoreCase)
            || !full.StartsWith(Root + "\\", StringComparison.OrdinalIgnoreCase))
            throw new Exception("拒绝清理安装目录以外的路径。");
        Exception last = null;
        for (int i = 0; i < 40; i++)
        {
            if (!Directory.Exists(full)) return;
            try { DeleteTree(full); return; }
            catch (IOException e) { last = e; }
            catch (UnauthorizedAccessException e) { last = e; }
            Thread.Sleep(250);
        }
        throw new Exception("临时数据仍被占用，请稍后双击“关闭并清理”：\r\n" + full + "\r\n" + (last == null ? "" : last.Message));
    }

    static void DeleteTree(string path)
    {
        // Never follow links/junctions, including ones placed in the temporary root.
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        { Directory.Delete(path, false); return; }
        foreach (string file in Directory.GetFiles(path))
        { if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) File.SetAttributes(file, FileAttributes.Normal); File.Delete(file); }
        foreach (string child in Directory.GetDirectories(path)) DeleteTree(child);
        Directory.Delete(path, false);
    }

    static string Quote(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);

    sealed class ChildJob : IDisposable
    {
        IntPtr handle;
        public ChildJob()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception();
            var limits = new ExtendedLimits();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
            { int error = Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error); }
        }
        public Process Start(string exe, string args, string cwd, bool hidden)
        {
            var si = new StartupInfo(); si.cb = Marshal.SizeOf(typeof(StartupInfo));
            var pi = new ProcessInfo();
            uint flags = 0x00000004u | (hidden ? 0x08000000u : 0u); // suspended + no console for Node
            if (!CreateProcess(exe, new StringBuilder(Quote(exe) + " " + args), IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, cwd, ref si, out pi))
                throw new Win32Exception();
            try
            {
                if (!AssignProcessToJobObject(handle, pi.hProcess)) throw new Win32Exception();
                Process process = Process.GetProcessById((int)pi.dwProcessId);
                // Retain a handle before resuming, even if the child exits immediately.
                IntPtr retained = process.Handle;
                if (ResumeThread(pi.hThread) == UInt32.MaxValue) { process.Dispose(); throw new Win32Exception(); }
                return process;
            }
            catch { TerminateProcess(pi.hProcess, 1); throw; }
            finally { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
        }
        public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    }

    [StructLayout(LayoutKind.Sequential)] struct BasicLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters
    { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits
    {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo
    { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
