using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

internal static class Common
{
    public const string Version = "0.2.0";
    public const string Folder = "sp-local-tools";
    public const string Product = "Stronghold-Protocol-Trainer";
    public static string Full(string path)
    {
        string full = Path.GetFullPath(path.Trim().Trim('"'));
        return full == Path.GetPathRoot(full) ? full : full.TrimEnd(Path.DirectorySeparatorChar);
    }
    public static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    public static string Key(string root)
    {
        using (var hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Full(root).ToLowerInvariant()))).Replace("-", "").Substring(0, 24);
    }
    public static string MutexName(string root) { return "Local\\StrongholdTools-" + Key(root); }
    public static Dictionary<string, object> Json(string file)
    { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(file)); }
    public static void NoLink(string path)
    {
        if ((File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new Exception("扩展目录不能是符号链接或目录联接：" + path);
    }
    public static string VerifyGame(string path)
    {
        string root = Full(path);
        string manifest = Path.Combine(root, "package.json");
        if (!File.Exists(manifest)) throw new Exception("请选择本体根目录（其中应包含 package.json、server、public）。");
        var pkg = Json(manifest);
        if (!pkg.ContainsKey("name") || (string)pkg["name"] != "stronghold-protocol-alliance") throw new Exception("该目录不是卫戍协议本体。");
        if (!pkg.ContainsKey("version") || (string)pkg["version"] != "0.1.3") throw new Exception("当前扩展已验证兼容本体 v0.1.3。此版本尚未支持，请先确认兼容性。");
        foreach (string rel in new [] { "server/index.js", "server/match/PlayerState.js", "shared/constants.js", "public/index.html", "public/js/ui/assetUrls.js", "data/items.json", "data/chess.json", "data/assets.json", "node_modules/ws/package.json" })
            if (!File.Exists(Path.Combine(root, rel.Replace('/', '\\')))) throw new Exception("本体缺少 " + rel + "。请先按照本体 README 完成快速开始。");
        if (!Directory.Exists(Path.Combine(root, "public/assets"))) throw new Exception("本体缺少素材，请使用包含素材的完整包。");
        FindNode(root);
        return root;
    }
    public static string FindNode(string game)
    {
        var candidates = new List<string>();
        candidates.Add(Path.Combine(game, "runtime/node.exe"));
        foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            if (!String.IsNullOrWhiteSpace(dir)) { try { candidates.Add(Path.Combine(dir.Trim().Trim('"'), "node.exe")); } catch { } }
        foreach (string node in candidates)
        {
            if (!File.Exists(node)) continue;
            var info = new ProcessStartInfo(node, "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using (var p = Process.Start(info))
            {
                if (!p.WaitForExit(5000)) { p.Kill(); continue; }
                string version = p.StandardOutput.ReadToEnd().Trim();
                if (p.ExitCode == 0 && (version.StartsWith("v22.") || version.StartsWith("v24."))) return Path.GetFullPath(node);
            }
        }
        throw new Exception("未找到 Node.js 22/24。请安装后重新打开安装器，或将 node.exe 放在本体 runtime 目录。");
    }
    // Called only for an exact owned child path. Reparse points are never traversed.
    public static void DeleteTree(string path, string parent)
    {
        path = Full(path); parent = Full(parent);
        string prefix = parent.EndsWith("\\") ? parent : parent + "\\";
        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || path == parent) throw new Exception("拒绝清理目标目录外的路径。");
        if (!Directory.Exists(path)) return;
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { Directory.Delete(path, false); return; }
        foreach (string file in Directory.GetFiles(path)) { if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) File.SetAttributes(file, FileAttributes.Normal); File.Delete(file); }
        foreach (string child in Directory.GetDirectories(path)) DeleteTree(child, parent);
        Directory.Delete(path, false);
    }
}
