#include "store.h"
#include <fstream>
#include <mutex>
#include <cstdio>
#include <sys/stat.h>
#include <sys/types.h>

namespace store {

static std::string g_data_dir = "data";
static std::mutex g_mu;

void set_data_dir(const std::string& dir) { g_data_dir = dir; }

static bool mkdirs(const std::string& path) {
    // 递归创建目录（简单版）
    std::string cur;
    for (size_t i = 0; i < path.size(); i++) {
        cur += path[i];
        if (path[i] == '/') {
            mkdir(cur.c_str(), 0755);
        }
    }
    mkdir(path.c_str(), 0755);
    return true;
}

nlohmann::json load(const std::string& path) {
    std::lock_guard<std::mutex> lk(g_mu);
    std::ifstream f(path);
    if (!f) return nlohmann::json::object();
    try {
        nlohmann::json j;
        f >> j;
        return j;
    } catch (...) {
        return nlohmann::json::object();
    }
}

void save(const std::string& path, const nlohmann::json& j) {
    std::lock_guard<std::mutex> lk(g_mu);
    std::string dir = path.substr(0, path.find_last_of('/'));
    mkdirs(dir.empty() ? "." : dir);
    std::string tmp = path + ".tmp";
    {
        std::ofstream f(tmp, std::ios::trunc);
        if (!f) return;
        f << j.dump(2);
    }
    rename(tmp.c_str(), path.c_str()); // 原子替换
}

} // namespace store