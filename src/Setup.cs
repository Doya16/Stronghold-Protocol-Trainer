using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Reflection;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

internal static class Setup
{
    static readonly string[] Payload = { "StrongholdLocalTools.exe", "game-api.mjs", "local-tools.mjs", "panel.js", "server.mjs", "LICENSE", "NOTICE.md" };
    static readonly string[] Links = { "卫戍协议本地修改器 - 启动.lnk", "卫戍协议本地修改器 - 关闭并清理.lnk" };
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 2 && args[0].StartsWith("--"))
        {
            try { Run(args[0].Substring(2), args[1]); Console.WriteLine("OK"); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }
        Application.EnableVisualStyles();
        var form = new Form { Text = "Stronghold Protocol Trainer | 卫戍协议本地修改器 " + Common.Version, ClientSize = new Size(680, 330), StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, Font = new Font("Microsoft YaHei UI", 10) };
        var title = new Label { Text = "选择本体目录，安装卫戍协议本地修改器", Left = 22, Top = 22, Width = 620, Height = 32, Font = new Font("Microsoft YaHei UI", 15, FontStyle.Bold) };
        var hint = new Label { Text = "支持本体 v0.1.3 · Windows x64 · 需要 Node.js 22/24 与 Chrome/Edge\n本体应已完成快速开始；安装前请关闭正在运行的扩展游戏。", Left = 22, Top = 60, Width = 640, Height = 50 };
        var path = new TextBox { Left = 22, Top = 121, Width = 530, Height = 30, AccessibleName = "卫戍协议本体根目录" };
        var browse = new Button { Text = "浏览…", Left = 565, Top = 119, Width = 92, Height = 33 };
        var status = new Label { Text = "仅安装扩展代码。物品图标和游戏数据从本体读取。", Left = 22, Top = 218, Width = 635, Height = 94 };
        form.Controls.AddRange(new Control[] { title, hint, path, browse, status });
        browse.Click += delegate { using (var dialog = new FolderBrowserDialog { Description = "选择卫戍协议本体根目录", ShowNewFolderButton = false }) { if (dialog.ShowDialog(form) == DialogResult.OK) path.Text = dialog.SelectedPath; } };
        string[] labels = { "安装 / 启用", "启动游戏", "停用", "卸载扩展" };
        string[] actions = { "install", "launch", "disable", "uninstall" };
        for (int i = 0; i < labels.Length; i++)
        {
            string action = actions[i];
            var button = new Button { Text = labels[i], Left = 22 + i * 162, Top = 169, Width = 149, Height = 36 };
            button.Click += delegate {
                form.UseWaitCursor = true;
                try { Run(action, path.Text); status.ForeColor = Color.DarkGreen; status.Text = action == "install" ? "已安装并启用！点击“启动游戏”，或双击本体目录的“卫戍协议本地修改器 - 启动”。\n关窗后自动关闭服务并清理本次浏览器缓存。" : action == "uninstall" ? "扩展已卸载。本体文件保留。" : action == "disable" ? "扩展已停用；本体原来的启动方式仍可使用。" : "游戏已启动。休整期点击右下角“修改面板”。"; }
                catch (Exception e) { status.ForeColor = Color.Firebrick; status.Text = e.Message; }
                finally { form.UseWaitCursor = false; }
            };
            form.Controls.Add(button);
        }
        Application.Run(form); return 0;
    }
    static void Owned(string addon)
    {
        Common.NoLink(addon);
        string marker = Path.Combine(addon, "installation.json");
        Common.NoLink(marker);
        if (!File.Exists(marker) || !Common.Json(marker).ContainsKey("product") || (string)Common.Json(marker)["product"] != Common.Product)
            throw new Exception("目标扩展目录不属于此安装器，已保留原文件：" + addon);
        foreach (string file in Directory.GetFiles(addon)) Common.NoLink(file);
    }
    static bool OwnLink(string file, string exe)
    {
        if (!File.Exists(file)) return true;
        Common.NoLink(file);
        var link = (IShellLinkW)new ShellLink();
        try {
            ((IPersistFile)link).Load(file, 0);
            var target = new StringBuilder(32768);
            link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
            return String.Equals(target.ToString(), exe, StringComparison.OrdinalIgnoreCase);
        } finally { Marshal.FinalReleaseComObject(link); }
    }
    static void SaveLink(string path, string exe, string args, string game)
    {
        // Native Unicode shell-link API supports Chinese directories and filenames on any locale.
        string temp = Path.Combine(game, ".sp-tools-shortcut-" + Guid.NewGuid().ToString("N") + ".lnk");
        try {
            var link = (IShellLinkW)new ShellLink();
            try { link.SetPath(exe); link.SetArguments(args); link.SetWorkingDirectory(game); ((IPersistFile)link).Save(temp, true); }
            finally { Marshal.FinalReleaseComObject(link); }
            if (File.Exists(path)) File.Delete(path);
            File.Move(temp, path);
        } finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink { }
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, uint flags);
        void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetHotkey(out short hotkey); void SetHotkey(short hotkey);
        void GetShowCmd(out int cmd); void SetShowCmd(int cmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string file, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }
    public static void Run(string action, string input)
    {
        if (String.IsNullOrWhiteSpace(input)) throw new Exception("请先输入或选择本体路径。");
        string game = Common.Full(input), addon = Path.Combine(game, Common.Folder), exe = Path.Combine(addon, "StrongholdLocalTools.exe");
        if (action == "launch") { Owned(addon); Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = game }); return; }
        if (action != "install" && action != "uninstall" && action != "disable") throw new Exception("未知操作。");
        if (action == "install") Common.VerifyGame(game);
        using (var mutex = new Mutex(false, Common.MutexName(addon)))
        {
            bool owns = false;
            try {
                try { owns = mutex.WaitOne(0); } catch (AbandonedMutexException) { owns = true; }
                if (!owns) throw new Exception("扩展游戏正在运行，请先关闭游戏后再安装、停用或卸载。");
                if (Directory.Exists(addon)) Owned(addon);
                else if (action != "install") throw new Exception("此目录尚未安装扩展。");
                foreach (string link in Links) if (!OwnLink(Path.Combine(game, link), exe)) throw new Exception("同名快捷方式不属于此扩展，未覆盖：" + link);
                if (action == "disable") { File.WriteAllText(Path.Combine(addon, "disabled"), "disabled"); return; }
                if (action == "uninstall") {
                    // Never remove user-added files. Runtime data is the launcher's explicitly disposable directory.
                    foreach (string file in Directory.GetFiles(addon)) {
                        string name = Path.GetFileName(file);
                        if (Array.IndexOf(Payload, name) < 0 && name != "installation.json" && name != "disabled") throw new Exception("扩展目录含额外文件，请先移出后再卸载：" + name);
                    }
                    foreach (string dir in Directory.GetDirectories(addon)) if (Path.GetFileName(dir) != "runtime-data") throw new Exception("扩展目录含额外目录，请先移出后再卸载：" + dir);
                    Common.DeleteTree(addon, game);
                    foreach (string link in Links) { string file = Path.Combine(game, link); if (File.Exists(file)) File.Delete(file); }
                    return;
                }
                // Stage the complete payload before changing an existing installation; roll back failed swaps.
                string stage = Path.Combine(game, ".sp-tools-stage-" + Guid.NewGuid().ToString("N"));
                string backup = Path.Combine(game, ".sp-tools-backup-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(stage);
                bool replaced = false;
                try {
                    foreach (string name in Payload) using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload." + name)) {
                        if (source == null) throw new Exception("安装包不完整：" + name);
                        using (var output = File.Create(Path.Combine(stage, name))) source.CopyTo(output);
                    }
                    File.WriteAllText(Path.Combine(stage, "installation.json"), "{\"product\":\"" + Common.Product + "\",\"version\":\"" + Common.Version + "\",\"gameVersion\":\"0.1.3\"}", new UTF8Encoding(false));
                    if (Directory.Exists(addon)) {
                        // Only owned files may be replaced. Preserve unknown files by refusing the upgrade.
                        foreach (string f in Directory.GetFiles(addon)) if (Array.IndexOf(Payload, Path.GetFileName(f)) < 0 && Path.GetFileName(f) != "installation.json" && Path.GetFileName(f) != "disabled") throw new Exception("扩展目录含额外文件，请先移出：" + f);
                        foreach (string d in Directory.GetDirectories(addon)) if (Path.GetFileName(d) != "runtime-data") throw new Exception("扩展目录含额外目录，请先移出：" + d);
                        Directory.Move(addon, backup);
                    }
                    try { Directory.Move(stage, addon); replaced = true; }
                    catch { if (Directory.Exists(backup)) Directory.Move(backup, addon); throw; }
                    SaveLink(Path.Combine(game, Links[0]), exe, "", game);
                    SaveLink(Path.Combine(game, Links[1]), exe, "--stop", game);
                }
                finally {
                    if (Directory.Exists(stage)) Common.DeleteTree(stage, game);
                    if (replaced && Directory.Exists(backup)) Common.DeleteTree(backup, game);
                }
            }
            finally { if (owns) mutex.ReleaseMutex(); }
        }
    }
}
