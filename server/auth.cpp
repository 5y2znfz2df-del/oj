#include "auth.h"
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

std::string Auth::login(const std::string& username, const std::string& role) {
    std::string tok = random_token();
    {
        std::lock_guard<std::mutex> lk(mu_);
        sessions_[tok] = Session{username, role};
    }
    return tok;
}

bool Auth::check(const std::string& token, Session& out) {
    std::lock_guard<std::mutex> lk(mu_);
    auto it = sessions_.find(token);
    if (it == sessions_.end()) return false;
    out = it->second;
    return true;
}

void Auth::logout(const std::string& token) {
    std::lock_guard<std::mutex> lk(mu_);
    sessions_.erase(token);
}