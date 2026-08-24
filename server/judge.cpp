#include "judge.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <fcntl.h>
#include <fstream>
#include <sstream>
#include <signal.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace std;

JudgeResult Judge::run(const string& code, const vector<TestCase>& cases,
                       int time_limit_sec, int memory_limit_mb) {
    JudgeResult res;
    res.status = "CE";

    static int seq = 0;
    string dir = temp_dir_ + "/sub_" + to_string((long)getpid()) + "_" +
                 to_string((long)time(nullptr)) + "_" + to_string(seq++);
    mkdir(temp_dir_.c_str(), 0755);
    mkdir(dir.c_str(), 0755);
    string exe = dir + "/solution";

    string err;
    if (!compile(code, dir, exe, err)) {
        res.status = "CE";
        res.detail = err;
        system(("rm -rf " + dir).c_str());
        return res;
    }

    int max_time = 0, max_mem = 0;
    for (size_t i = 0; i < cases.size(); i++) {
        JudgeResult r = run_one(exe, cases[i], time_limit_sec, memory_limit_mb);
        max_time = max(max_time, r.time_ms);
        max_mem = max(max_mem, r.memory_kb);
        if (r.status != "AC") {
            r.time_ms = max_time;
            r.memory_kb = max_mem;
            ostringstream ss;
            ss << "测试点 " << (i + 1) << "/" << cases.size() << ": " << r.status;
            if (!r.detail.empty()) ss << "（" << r.detail << "）";
            r.detail = ss.str();
            system(("rm -rf " + dir).c_str());
            return r;
        }
    }

    res.status = "AC";
    res.time_ms = max_time;
    res.memory_kb = max_mem;
    system(("rm -rf " + dir).c_str());
    return res;
}

bool Judge::compile(const string& code, const string& dir,
                    const string& exe, string& err_msg) {
    ofstream f(dir + "/main.cpp", ios::trunc);
    f << code;
    f.close();

    string ce_log = dir + "/ce.txt";
    string cmd = "g++ -O2 -std=c++17 -o " + exe + " " + dir + "/main.cpp 2> " + ce_log;
    int rc = system(cmd.c_str());
    if (rc != 0) {
        ifstream cf(ce_log);
        ostringstream ss;
        ss << cf.rdbuf();
        string s = ss.str();
        if (s.size() > 4000) s = s.substr(s.size() - 4000); // 错误信息保留尾部
        err_msg = s;
        return false;
    }
    return true;
}

// 运行单个测试点：喂输入、收输出、掐时间、限内存
JudgeResult Judge::run_one(const string& exe, const TestCase& tc,
                           int time_limit_sec, int memory_limit_mb) {
    JudgeResult res;
    res.status = "RE";

    int in_pipe[2], out_pipe[2];
    if (pipe(in_pipe) != 0 || pipe(out_pipe) != 0) return res;

    pid_t pid = fork();
    if (pid < 0) {
        close(in_pipe[0]); close(in_pipe[1]);
        close(out_pipe[0]); close(out_pipe[1]);
        return res;
    }

    if (pid == 0) {
        // ---- 子进程：套限制 + 跑程序 ----
        dup2(in_pipe[0], STDIN_FILENO);
        dup2(out_pipe[1], STDOUT_FILENO);
        dup2(out_pipe[1], STDERR_FILENO);
        close(in_pipe[0]); close(in_pipe[1]);
        close(out_pipe[0]); close(out_pipe[1]);

        struct rlimit rl;
        // CPU 时间限制（超了发 SIGXCPU）
        rl.rlim_cur = rl.rlim_max = (rlim_t)time_limit_sec + 1;
        setrlimit(RLIMIT_CPU, &rl);
        // 内存限制（虚拟内存总量）
        rl.rlim_cur = rl.rlim_max = (rlim_t)memory_limit_mb * 1024 * 1024;
        setrlimit(RLIMIT_AS, &rl);
        // 输出文件限制，防刷屏撑爆磁盘
        rl.rlim_cur = rl.rlim_max = 64 * 1024 * 1024;
        setrlimit(RLIMIT_FSIZE, &rl);

        execl(exe.c_str(), exe.c_str(), (char*)nullptr);
        _exit(127);
    }

    // ---- 父进程：喂输入 ----
    close(in_pipe[0]);
    close(out_pipe[1]);
    size_t written = 0;
    while (written < tc.input.size()) {
        ssize_t n = write(in_pipe[1], tc.input.data() + written, tc.input.size() - written);
        if (n <= 0) break;
        written += (size_t)n;
    }
    close(in_pipe[1]);

    // ---- 收输出（非阻塞 + 轮询，超时斩杀）----
    fcntl(out_pipe[0], F_SETFL, O_NONBLOCK);
    string output;
    char buf[8192];
    int status = 0;
    bool timed_out = false;
    auto start = chrono::steady_clock::now();

    while (true) {
        ssize_t n = read(out_pipe[0], buf, sizeof(buf));
        if (n > 0) { output.append(buf, (size_t)n); continue; }
        if (n == 0) { waitpid(pid, &status, 0); break; } // EOF：等它退出

        pid_t w = waitpid(pid, &status, WNOHANG);
        if (w == pid) break;
        if (w == 0) {
            auto ms = chrono::duration_cast<chrono::milliseconds>(
                          chrono::steady_clock::now() - start).count();
            if (ms > (long long)(time_limit_sec + 1) * 1000) {
                kill(pid, SIGKILL);
                waitpid(pid, &status, 0);
                timed_out = true;
                break;
            }
            usleep(2000);
        }
    }
    close(out_pipe[0]);

    long long ms = chrono::duration_cast<chrono::milliseconds>(
                       chrono::steady_clock::now() - start).count();
    struct rusage ru;
    int max_kb = 0;
    if (getrusage(RUSAGE_CHILDREN, &ru) == 0) {
        max_kb = (int)ru.ru_maxrss; // Linux 单位 KB
#ifdef __APPLE__
        max_kb /= 1024;             // macOS 单位是字节，换算成 KB
#endif
    }

    res.time_ms = (int)ms;
    res.memory_kb = max_kb;

    if (timed_out) { res.status = "TLE"; return res; }
    if (WIFSIGNALED(status)) {
        int sig = WTERMSIG(status);
        res.status = (sig == SIGXCPU || sig == SIGKILL) ? "TLE" : "RE";
        return res;
    }
    if (WEXITSTATUS(status) != 0) { res.status = "RE"; return res; }

    res.status = same_output(output, tc.output) ? "AC" : "WA";
    return res;
}

// 忽略行尾空白与末尾空行的宽松比对
bool Judge::same_output(const string& got, const string& expected) {
    auto lines_of = [](const string& s) {
        vector<string> v;
        string cur;
        for (char c : s) {
            if (c == '\n') { v.push_back(cur); cur.clear(); }
            else cur += c;
        }
        if (!cur.empty()) v.push_back(cur);
        while (!v.empty() && v.back().empty()) v.pop_back();
        for (auto& l : v) {
            while (!l.empty() && (l.back() == ' ' || l.back() == '\t' || l.back() == '\r'))
                l.pop_back();
        }
        return v;
    };
    return lines_of(got) == lines_of(expected);
}