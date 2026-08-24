#pragma once
// =============================================
// JSON 文件存储（题库/训练/公告/班级/商城）
// 写操作：临时文件 + rename，原子替换，不怕写一半
// =============================================
#include <string>
#include "json.hpp"

namespace store {

void set_data_dir(const std::string& dir);

nlohmann::json load(const std::string& path);            // 读，文件不存在返回 {}
void save(const std::string& path, const nlohmann::json& j); // 写，自动建目录

} // namespace store