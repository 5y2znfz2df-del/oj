#pragma once
// =============================================
// 认证：SHA256 密码哈希 + 内存会话（token）
// =============================================
#include <string>
#include <unordered_map>
#include <mutex>

struct Session {
    std::string username;
    std::string role;
};

class Auth {
public:
    // 密码 -> SHA256 十六进制串
    static std::string sha256(const std::string& s);

    // 登录成功：生成 token 并记录会话
    std::string login(const std::string& username, const std::string& role);

    // 校验 token，成功返回 true 并填充会话
    bool check(const std::string& token, Session& out);

    void logout(const std::string& token);

private:
    std::unordered_map<std::string, Session> sessions_;
    std::mutex mu_;
};