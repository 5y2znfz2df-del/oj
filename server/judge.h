#pragma once
// =============================================
// 判题核心：编译 + 运行测试点 + 比对输出
// =============================================
#include <string>
#include <vector>

struct TestCase {
    std::string input;
    std::string output; // 期望输出
};

struct JudgeResult {
    std::string status;    // AC / WA / TLE / RE / CE
    int time_ms   = 0;
    int memory_kb = 0;
    std::string detail;    // CE 时是编译错误信息
};

class Judge {
public:
    explicit Judge(const std::string& temp_dir = "temp") : temp_dir_(temp_dir) {}

    // 编译并跑完所有测试点，返回最终结果（失败即返回）
    JudgeResult run(const std::string& code,
                    const std::vector<TestCase>& cases,
                    int time_limit_sec, int memory_limit_mb);

private:
    std::string temp_dir_;

    bool compile(const std::string& code, const std::string& workdir,
                 const std::string& exe, std::string& err_msg);

    JudgeResult run_one(const std::string& exe, const TestCase& tc,
                        int time_limit_sec, int memory_limit_mb);

    static bool same_output(const std::string& got, const std::string& expected);
};