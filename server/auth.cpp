#include "auth.h"
#include "db.h"
#include <openssl/sha.h>
#include <cstdio>
#include <random>
#include <sstream>

std::string Auth::sha256(const std::string& s) {
    unsigned char md[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(s.data()), s.size(), md);
    char buf[65];
    for (int i = 0; i < 32; i++)
        snprintf(buf + i * 2, 3, "%02x", md[i]);
    return std::string(buf, 64);
}

static std::string random_token() {
    std::random_device rd;
    std::stringstream ss;
    for (int i = 0; i < 16; i++) {
        ss << std::hex << (rd() % 256);
    }
    return ss.str();
}

std::string Auth::login(DB& db, const std::string& username, const std::string& role) {
    std::string tok = random_token();
    db.query("INSERT INTO sessions(token,username,role) VALUES('" +
             db.escape(tok) + "','" + db.escape(username) + "','" + db.escape(role) + "')");
    return tok;
}

bool Auth::check(DB& db, const std::string& token, Session& out) {
    if (token.empty()) return false;
    // 更新 last_seen 并查会话
    auto rows = db.rows("SELECT username,role FROM sessions WHERE token='" +
                        db.escape(token) + "' LIMIT 1");
    if (rows.empty()) return false;
    out.username = rows[0][0];
    out.role = rows[0][1];
    // 异步刷新 last_seen（失败无所谓）
    db.query("UPDATE sessions SET last_seen=NOW() WHERE token='" + db.escape(token) + "'");
    return true;
}

void Auth::logout(DB& db, const std::string& token) {
    if (token.empty()) return;
    db.query("DELETE FROM sessions WHERE token='" + db.escape(token) + "'");
}
