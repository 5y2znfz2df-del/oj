// =============================================
// 比特 OJ - 后端主服务
// 路由 + 业务逻辑 + 静态文件服务
// 依赖：cpp-httplib / nlohmann-json / MySQL C API / OpenSSL
// =============================================
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <mutex>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unordered_map>
#include <vector>

#include "httplib.h"
#include "json.hpp"

#include "auth.h"
#include "db.h"
#include "judge.h"
#include "store.h"

using namespace std;
using json = nlohmann::json;

static DB         g_db;
static Auth       g_auth;
static string     DATA_DIR = "data";
static string     TEMP_DIR = "temp";
static mutex      g_biz_mu;   // 保护「读-改-写」复合操作（购买/加入班级等）

const int AC_POINTS  = 10;    // 首 AC 一题得 10 分
const int PAGE_SIZE  = 20;
const int MAX_CODE_LEN = 100000;

// ---------------- 工具函数 ----------------
static json ok_j(const json& extra = json::object()) {
    json j = {{"ok", true}};
    for (auto it = extra.begin(); it != extra.end(); ++it) j[it.key()] = it.value();
    return j;
}
static void respond(httplib::Response& res, const json& j) {
    res.set_content(j.dump(), "application/json; charset=utf-8");
}
static void fail(httplib::Response& res, int code, const string& msg) {
    json j = {{"ok", false}, {"msg", msg}};
    res.status = code;
    respond(res, j);
}
static json parse_body(const httplib::Request& req) {
    try { return json::parse(req.body); } catch (...) { return json::object(); }
}

static string bearer_token(const httplib::Request& req) {
    auto it = req.headers.find("Authorization");
    if (it == req.headers.end()) return "";
    string v = it->second;
    if (v.rfind("Bearer ", 0) == 0) return v.substr(7);
    return v;
}

// 返回当前用户 json（未登录返回空 json）
static json current_user(const httplib::Request& req) {
    string tok = bearer_token(req);
    if (tok.empty()) return json();
    Session s;
    if (!g_auth.check(g_db, tok, s)) return json();
    auto rows = g_db.rows("SELECT id,username,role,points,solved_count FROM users"
                          " WHERE username='" + g_db.escape(s.username) + "' LIMIT 1");
    if (rows.empty()) return json();
    json u = {{"id", stoll(rows[0][0])}, {"username", rows[0][1]},
              {"role", rows[0][2]},       {"points", stoi(rows[0][3])},
              {"solved_count", stoi(rows[0][4])}};
    return u;
}
static json require_user(const httplib::Request& req, httplib::Response& res) {
    auto u = current_user(req);
    if (u.empty()) { fail(res, 401, "请先登录"); return json(); }
    return u;
}
static json require_admin(const httplib::Request& req, httplib::Response& res) {
    auto u = require_user(req, res);
    if (u.empty()) return json();
    if (u["role"] != "admin") { fail(res, 403, "需要管理员权限"); return json(); }
    return u;
}

// 班级管理员：超级管理员(admin) 或 班级管理员(class_admin) 都过
static json require_class_admin(const httplib::Request& req, httplib::Response& res) {
    auto u = require_user(req, res);
    if (u.empty()) return json();
    string r = u.value("role", "");
    if (r != "admin" && r != "class_admin") { fail(res, 403, "需要班级管理员权限"); return json(); }
    return u;
}

// ---------------- 数据文件访问 ----------------
static json load_data(const string& name) { return store::load(DATA_DIR + "/" + name); }
static void save_data(const string& name, const json& j) { store::save(DATA_DIR + "/" + name, j); }

// 班级扩展内容读取/保存（题库/比赛/训练/作业）
static json load_class_content(int cid) {
    auto cc = load_data("class_contents.json");
    string key = to_string(cid);
    if (!cc.contains(key) || !cc[key].is_object()) cc[key] = json::object();
    auto& c = cc[key];
    if (!c.contains("problems"))  c["problems"]  = json::array();
    if (!c.contains("contests"))  c["contests"]  = json::array();
    if (!c.contains("trainings")) c["trainings"] = json::array();
    if (!c.contains("homeworks")) c["homeworks"] = json::array();
    return cc;
}
static void save_class_content(int cid, const json& full) {
    save_data("class_contents.json", full);
}

static int next_id(const json& arr) {
    int mx = 0;
    for (auto& x : arr) mx = max(mx, x.value("id", 0));
    return mx + 1;
}
static json problems_file() { return load_data("problems.json"); }

static void mkdirs(const string& path) {
    string cur;
    for (size_t i = 0; i < path.size(); i++) {
        cur += path[i];
        if (path[i] == '/') mkdir(cur.c_str(), 0755);
    }
    mkdir(path.c_str(), 0755);
}

// ---------------- 路由注册 ----------------
static void register_routes(httplib::Server& svr) {

    // ========== 认证 ==========
    svr.Post("/api/register", [](const httplib::Request& req, httplib::Response& res) {
        auto b = parse_body(req);
        string name = b.value("username", ""), pass = b.value("password", "");
        if (name.size() < 3 || name.size() > 32) return fail(res, 400, "用户名长度须为 3-32 字符");
        if (pass.size() < 6 || pass.size() > 64) return fail(res, 400, "密码长度须为 6-64 字符");
        auto dup = g_db.rows("SELECT id FROM users WHERE username='" + g_db.escape(name) + "'");
        if (!dup.empty()) return fail(res, 400, "用户名已被注册，换一个试试");
        if (!g_db.query("INSERT INTO users(username,password,role) VALUES('" +
                        g_db.escape(name) + "','" + Auth::sha256(pass) + "','user')"))
            return fail(res, 500, "注册失败，请稍后再试");
        string tok = g_auth.login(g_db, name, "user");
        respond(res, ok_j({{"token", tok}, {"username", name}, {"role", "user"},
                           {"points", 0}, {"solved_count", 0}}));
    });

    svr.Post("/api/login", [](const httplib::Request& req, httplib::Response& res) {
        auto b = parse_body(req);
        string name = b.value("username", ""), pass = b.value("password", "");
        auto r = g_db.rows("SELECT id,username,password,role,points,solved_count FROM users"
                           " WHERE username='" + g_db.escape(name) + "' LIMIT 1");
        if (r.empty() || r[0][2] != Auth::sha256(pass))
            return fail(res, 401, "用户名或密码错误");
        string tok = g_auth.login(g_db, r[0][1], r[0][3]);
        respond(res, ok_j({{"token", tok}, {"username", r[0][1]}, {"role", r[0][3]},
                           {"points", stoi(r[0][4])}, {"solved_count", stoi(r[0][5])}}));
    });

    svr.Post("/api/logout", [](const httplib::Request& req, httplib::Response& res) {
        g_auth.logout(g_db, bearer_token(req));
        respond(res, ok_j());
    });

    svr.Get("/api/me", [](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        if (u.empty()) return fail(res, 401, "未登录");
        respond(res, ok_j({{"user", u}}));
    });

    // ========== 个人资料（段位/签名/热度） ==========
    // 段位计算：RR = AC数*50 + 积分*0.5
    // 无畏契约国服段位 (9 个)
    auto calc_tier = [](int ac_count, int points) -> json {
        int rr = ac_count * 50 + (int)(points * 0.5);
        const char* names[] = {
            "无段位", "黑铁", "青铜", "白银", "黄金",
            "铂金", "钻石", "战神", "不朽", "超凡入圣"
        };
        const int thresholds[] = {0, 0, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700};
        const char* colors[] = {
            "#9ca3af", "#6b7280", "#a16207", "#94a3b8", "#eab308",
            "#06b6d4", "#a855f7", "#10b981", "#ef4444", "#fbbf24"
        };
        int tier = 0;
        for (int i = 9; i >= 0; i--) {
            if (rr >= thresholds[i]) { tier = i; break; }
        }
        int sub = 0;
        if (tier < 9) {
            int lo = thresholds[tier], hi = thresholds[tier + 1];
            sub = (hi > lo) ? (int)((rr - lo) * 3.0 / (hi - lo)) : 0;
            if (sub > 2) sub = 2;
        } else {
            sub = 3;  // Radiant 不分子段位
        }
        int next_rr = (tier < 9) ? thresholds[tier + 1] : rr;
        int prev_rr = thresholds[tier];
        return json{
            {"tier", tier}, {"name", names[tier]}, {"sub", sub},
            {"rr", rr}, {"prev_rr", prev_rr}, {"next_rr", next_rr},
            {"color", colors[tier]}, {"label", sub == 3 ? "超凡入圣" : (std::string(names[tier]) + " " + (sub==0?"I":sub==1?"II":"III"))}
        };
    };
    (void)calc_tier;  // 避免未使用警告（被下面 lambda 用）

    svr.Get("/api/me/profile", [&calc_tier](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        if (u.empty()) return fail(res, 401, "未登录");
        long long uid = u["id"].get<long long>();
        auto urows = g_db.rows("SELECT signature FROM users WHERE id=" + to_string(uid));
        string signature = urows.empty() ? "" : urows[0][0];
        // 提交热度：近7天提交总数×1 + AC 数×2
        auto heat_rows = g_db.rows(
            "SELECT COUNT(*), SUM(status='AC') FROM submissions"
            " WHERE user_id=" + to_string(uid) +
            " AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
        int sub_total = heat_rows.empty() ? 0 : stoi(heat_rows[0][0]);
        int ac_in_heat = (heat_rows.empty() || heat_rows[0][1].empty()) ? 0 : stoi(heat_rows[0][1]);
        int heat = sub_total + ac_in_heat * 2;
        int ac_count = u["solved_count"].get<int>();
        int points = u["points"].get<int>();
        json user_obj = {{"id", uid}, {"username", u["username"]}, {"role", u["role"]},
                         {"points", points}, {"solved", ac_count}};
        json heat_bd = {{"submissions_7d", sub_total}, {"ac_7d", ac_in_heat}};
        json tier_obj = calc_tier(ac_count, points);
        json resp_obj = {{"user", user_obj}, {"signature", signature},
                         {"tier", tier_obj}, {"heat", heat}, {"heat_breakdown", heat_bd}};
        respond(res, ok_j(resp_obj));
    });

    svr.Patch("/api/me", [](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        if (u.empty()) return fail(res, 401, "未登录");
        auto b = parse_body(req);
        if (!b.contains("signature")) return fail(res, 400, "signature 必填");
        string sig = b["signature"].get<string>();
        if (sig.size() > 200) sig = sig.substr(0, 200);
        g_db.query("UPDATE users SET signature='" + g_db.escape(sig) +
                   "' WHERE id=" + to_string(u["id"].get<long long>()));
        respond(res, ok_j({{"signature", sig}}));
    });

    // ========== 题目笔记 ==========
    svr.Get("/api/me/notes", [](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        if (u.empty()) return fail(res, 401, "未登录");
        auto rows = g_db.rows("SELECT problem_id, content, updated_at FROM user_notes"
                              " WHERE user_id=" + to_string(u["id"].get<long long>()) +
                              " ORDER BY updated_at DESC LIMIT 200");
        json list = json::array();
        for (auto& r : rows)
            list.push_back({{"problem_id", stoi(r[0])}, {"content", r[1]}, {"updated_at", r[2]}});
        respond(res, ok_j({{"notes", list}}));
    });

    svr.Put(R"(/api/me/note/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        if (u.empty()) return fail(res, 401, "未登录");
        int pid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        string content = b.value("content", "");
        long long uid = u["id"].get<long long>();
        // upsert
        if (content.empty()) {
            g_db.query("DELETE FROM user_notes WHERE user_id=" + to_string(uid) +
                       " AND problem_id=" + to_string(pid));
            return respond(res, ok_j({{"deleted", true}}));
        }
        g_db.query("INSERT INTO user_notes(user_id, problem_id, content) VALUES(" +
                   to_string(uid) + "," + to_string(pid) + ",'" + g_db.escape(content) + "')"
                   " ON DUPLICATE KEY UPDATE content='" + g_db.escape(content) + "'");
        respond(res, ok_j());
    });

    svr.Delete(R"(/api/me/note/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        if (u.empty()) return fail(res, 401, "未登录");
        int pid = stoi(req.matches[1].str());
        g_db.query("DELETE FROM user_notes WHERE user_id=" + to_string(u["id"].get<long long>()) +
                   " AND problem_id=" + to_string(pid));
        respond(res, ok_j());
    });

    // ========== 题库 ==========
    svr.Get("/api/problems", [](const httplib::Request& req, httplib::Response& res) {
        auto u = current_user(req);
        auto pf = problems_file();
        set<int> solved;
        if (!u.empty()) {
            auto r = g_db.rows("SELECT DISTINCT problem_id FROM submissions WHERE user_id=" +
                               to_string(u["id"].get<long long>()) + " AND status='AC'");
            for (auto& row : r) solved.insert(stoi(row[0]));
        }
        json list = json::array();
        for (auto& p : pf["problems"]) {
            list.push_back({{"id", p["id"]},
                            {"title", p.value("title", "")},
                            {"difficulty", p.value("difficulty", 1)},
                            {"tags", p.value("tags", json::array())},
                            {"solved", solved.count(p["id"].get<int>()) ? true : false}});
        }
        respond(res, ok_j({{"problems", list}}));
    });

    svr.Get(R"(/api/problems/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        int pid = stoi(req.matches[1].str());
        auto pf = problems_file();
        for (auto& p : pf["problems"]) {
            if (p["id"].get<int>() == pid) {
                json out = p;
                auto viewer = current_user(req);
                // 测试数据对普通用户保密，管理员（编辑题目）可见
                if (viewer.empty() || viewer["role"] != "admin")
                    out.erase("testcases");
                respond(res, ok_j({{"problem", out}}));
                return;
            }
        }
        fail(res, 404, "题目不存在");
    });

    // ========== 提交与判题 ==========
    svr.Post("/api/submit", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        if (!b.contains("problem_id") || !b.contains("code"))
            return fail(res, 400, "参数不完整");
        int pid = b["problem_id"].get<int>();
        string code = b["code"].get<string>();
        if (code.empty())                   return fail(res, 400, "代码不能为空");
        if (code.size() > MAX_CODE_LEN)     return fail(res, 400, "代码太长（上限 100KB）");

        auto pf = problems_file();
        json* prob = nullptr;
        for (auto& p : pf["problems"])
            if (p["id"].get<int>() == pid) { prob = &p; break; }
        if (!prob) return fail(res, 404, "题目不存在");

        // 插入提交记录（先 Pending）
        string uid = to_string(u["id"].get<long long>());
        if (!g_db.query("INSERT INTO submissions(user_id,problem_id,code,status) VALUES(" +
                        uid + "," + to_string(pid) + ",'" + g_db.escape(code) + "','Pending')"))
            return fail(res, 500, "提交失败，请稍后再试");
        long long sid = g_db.insert_id();

        // 判题
        vector<TestCase> cases;
        for (auto& tc : (*prob)["testcases"])
            cases.push_back({tc["input"].get<string>(), tc["output"].get<string>()});
        Judge judge(TEMP_DIR);
        JudgeResult r = judge.run(code, cases,
                                  prob->value("time_limit", 1),
                                  prob->value("memory_limit", 256));

        // 更新提交记录
        g_db.query("UPDATE submissions SET status='" + g_db.escape(r.status) +
                   "', time_ms=" + to_string(r.time_ms) +
                   ", memory_kb=" + to_string(r.memory_kb) + " WHERE id=" + to_string(sid));

        // 首 AC 加分（加锁防并发双加）
        if (r.status == "AC") {
            lock_guard<mutex> lk(g_biz_mu);
            auto cnt = g_db.rows("SELECT COUNT(*) FROM submissions WHERE user_id=" + uid +
                                 " AND problem_id=" + to_string(pid) + " AND status='AC'");
            bool first_ac = cnt.empty() || stoll(cnt[0][0]) == 0;
            if (first_ac)
                g_db.query("UPDATE users SET points=points+" + to_string(AC_POINTS) +
                           ", solved_count=solved_count+1 WHERE id=" + uid);
        }

        respond(res, ok_j({{"submission_id", sid}, {"status", r.status},
                           {"time_ms", r.time_ms}, {"memory_kb", r.memory_kb},
                           {"detail", r.detail}}));
    });

    // ========== 提交记录 ==========
    svr.Get("/api/submissions", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res);
        if (u.empty()) return;
        bool all = req.get_param_value("all") == "1" && u["role"] == "admin";
        int page = max(1, atoi(req.get_param_value("page").c_str()));
        string where = all ? "1=1" : "s.user_id=" + to_string(u["id"].get<long long>());
        auto r = g_db.rows("SELECT s.id,s.problem_id,s.status,s.time_ms,s.memory_kb,"
                           "s.created_at,u.username FROM submissions s "
                           "JOIN users u ON s.user_id=u.id WHERE " + where +
                           " ORDER BY s.id DESC LIMIT " + to_string(PAGE_SIZE) +
                           " OFFSET " + to_string((page - 1) * PAGE_SIZE));
        auto pf = problems_file();
        unordered_map<int, string> titles;
        for (auto& p : pf["problems"]) titles[p["id"].get<int>()] = p.value("title", "");
        json list = json::array();
        for (auto& row : r) {
            int pid = stoi(row[1]);
            list.push_back({{"id", stoll(row[0])}, {"problem_id", pid},
                            {"title", titles.count(pid) ? titles[pid] : "题目#" + to_string(pid)},
                            {"status", row[2]}, {"time_ms", stoi(row[3])},
                            {"memory_kb", stoi(row[4])}, {"created_at", row[5]},
                            {"username", row[6]}});
        }
        respond(res, ok_j({{"submissions", list}}));
    });

    // ========== 排行榜 ==========
    svr.Get("/api/ranklist", [](const httplib::Request& req, httplib::Response& res) {
        auto r = g_db.rows("SELECT username,solved_count,points FROM users "
                           "ORDER BY solved_count DESC, points DESC, id ASC LIMIT 100");
        json list = json::array();
        int rank = 1;
        for (auto& row : r)
            list.push_back({{"rank", rank++}, {"username", row[0]},
                            {"solved", stoi(row[1])}, {"points", stoi(row[2])}});
        respond(res, ok_j({{"ranklist", list}}));
    });

    // ========== 训练 ==========
    svr.Get("/api/trainings", [](const httplib::Request& req, httplib::Response& res) {
        auto tf = load_data("trainings.json");
        auto pf = problems_file();
        unordered_map<int, string> titles;
        for (auto& p : pf["problems"]) titles[p["id"].get<int>()] = p.value("title", "");
        json list = json::array();
        for (auto& t : tf.value("trainings", json::array())) {
            json probs = json::array();
            for (int pid : t.value("problem_ids", json::array()))
                probs.push_back({{"id", pid}, {"title",
                    titles.count(pid) ? titles[pid] : "题目#" + to_string(pid)}});
            list.push_back({{"id", t.value("id", 0)}, {"title", t.value("title", "")},
                            {"description", t.value("description", "")},
                            {"created_at", t.value("created_at", "")},
                            {"problems", probs}});
        }
        respond(res, ok_j({{"trainings", list}}));
    });

    // ========== 公告 ==========
    svr.Get("/api/announcements", [](const httplib::Request& req, httplib::Response& res) {
        auto af = load_data("announcements.json");
        respond(res, ok_j({{"announcements", af.value("announcements", json::array())}}));
    });

    // ========== 班级 ==========
    svr.Get("/api/classes", [](const httplib::Request& req, httplib::Response& res) {
        auto cf = load_data("classes.json");
        auto u = current_user(req);
        string me = u.empty() ? "" : u["username"].get<string>();
        json list = json::array();
        for (auto& c : cf.value("classes", json::array())) {
            json members = c.value("members", json::array());
            bool joined = false;
            for (auto& m : members) if (m.get<string>() == me) { joined = true; break; }
            list.push_back({{"id", c.value("id", 0)}, {"name", c.value("name", "")},
                            {"description", c.value("description", "")},
                            {"invite_code", c.value("invite_code", "")},
                            {"member_count", (int)members.size()},
                            {"joined", joined}});
        }
        respond(res, ok_j({{"classes", list}}));
    });

    svr.Post("/api/classes/join", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        string code = b.value("invite_code", "");
        lock_guard<mutex> lk(g_biz_mu);
        auto cf = load_data("classes.json");
        auto& cs = cf["classes"];
        for (auto& c : cs) {
            if (c.value("invite_code", "") != code) continue;
            for (auto& m : c["members"])
                if (m.get<string>() == u["username"]) return fail(res, 400, "你已经在这个班级里了");
            c["members"].push_back(u["username"]);
            save_data("classes.json", cf);
            return respond(res, ok_j({{"class_name", c.value("name", "")}}));
        }
        fail(res, 404, "邀请码不存在");
    });

    svr.Post("/api/classes/leave", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        int cid = b.value("id", 0);
        lock_guard<mutex> lk(g_biz_mu);
        auto cf = load_data("classes.json");
        auto& cs = cf["classes"];
        for (auto& c : cs) {
            if (c.value("id", 0) != cid) continue;
            auto& members = c["members"];
            for (size_t i = 0; i < members.size(); i++)
                if (members[i].get<string>() == u["username"]) {
                    members.erase(members.begin() + (long)i);
                    save_data("classes.json", cf);
                    return respond(res, ok_j());
                }
            return fail(res, 400, "你不在这个班级里");
        }
        fail(res, 404, "班级不存在");
    });

    // ========== 班级详情与扩展（题库/比赛/训练/作业） ==========

    // GET /api/class/{id} 班级详情
    svr.Get(R"(/api/class/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        int cid = stoi(req.matches[1].str());
        auto u = current_user(req);
        string me = u.empty() ? "" : u["username"].get<string>();
        auto cf = load_data("classes.json");
        json* cls = nullptr;
        for (auto& c : cf["classes"]) if (c.value("id", 0) == cid) { cls = &c; break; }
        if (!cls) return fail(res, 404, "班级不存在");
        bool joined = false;
        bool is_admin = !u.empty() && (u.value("role", "") == "admin" || u.value("role", "") == "class_admin");
        for (auto& m : (*cls)["members"]) if (m.get<string>() == me) { joined = true; break; }
        auto cc = load_class_content(cid);
        auto& cdata = cc[to_string(cid)];
        auto pf = load_data("problems.json");
        json probs = json::array();
        for (auto pidv : cdata["problems"]) {
            int pid = pidv.get<int>();
            for (auto& pp : pf["problems"]) {
                if (pp["id"].get<int>() == pid) {
                    probs.push_back({{"id", pid}, {"title", pp.value("title", "")},
                                     {"difficulty", pp.value("difficulty", 1)}});
                    break;
                }
            }
        }
        json out_cls = {
            {"id", cid},
            {"name", (*cls).value("name", "")},
            {"description", (*cls).value("description", "")},
            {"invite_code", (*cls).value("invite_code", "")},
            {"members", (*cls)["members"]},
            {"joined", joined},
            {"is_admin", is_admin}
        };
        respond(res, ok_j({{"class", out_cls},
                           {"problems", probs},
                           {"contests", cdata["contests"]},
                           {"trainings", cdata["trainings"]},
                           {"homeworks", cdata["homeworks"]}}));
    });

    // POST /api/admin/class/{id}/problem 添加题目到班级题库
    svr.Post(R"(/api/admin/class/(\d+)/problem)", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        int pid = b.value("problem_id", 0);
        if (pid <= 0) return fail(res, 400, "problem_id 必填");
        auto pf = load_data("problems.json");
        bool exists = false;
        for (auto& pp : pf["problems"]) if (pp["id"].get<int>() == pid) { exists = true; break; }
        if (!exists) return fail(res, 404, "题目不存在");
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& cdata = cc[to_string(cid)];
        for (auto pidv : cdata["problems"]) if (pidv.get<int>() == pid) return fail(res, 400, "题目已在班级题库");
        cdata["problems"].push_back(pid);
        save_class_content(cid, cc);
        respond(res, ok_j());
    });

    // DELETE /api/admin/class/{id}/problem/{pid}
    svr.Delete(R"(/api/admin/class/(\d+)/problem/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str());
        int pid = stoi(req.matches[2].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& probs = cc[to_string(cid)]["problems"];
        for (size_t i = 0; i < probs.size(); i++) {
            if (probs[i].get<int>() == pid) {
                probs.erase(probs.begin() + (long)i);
                save_class_content(cid, cc);
                return respond(res, ok_j());
            }
        }
        fail(res, 404, "题目不在班级题库");
    });

    // POST /api/admin/class/{id}/contest 创建比赛
    svr.Post(R"(/api/admin/class/(\d+)/contest)", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        string title = b.value("title", "");
        if (title.empty()) return fail(res, 400, "标题必填");
        auto probs = b.value("problems", json::array());
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& cdata = cc[to_string(cid)];
        int nid = 1;
        if (!cdata["contests"].empty()) nid = cdata["contests"].back().value("id", 0) + 1;
        cdata["contests"].push_back({{"id", nid}, {"title", title},
                                      {"problems", probs},
                                      {"start", b.value("start", "")},
                                      {"end", b.value("end", "")},
                                      {"created_at", b.value("created_at", "")}});
        save_class_content(cid, cc);
        respond(res, ok_j({{"id", nid}}));
    });

    // DELETE /api/admin/class/{id}/contest/{cid2}
    svr.Delete(R"(/api/admin/class/(\d+)/contest/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str()); int cid2 = stoi(req.matches[2].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& arr = cc[to_string(cid)]["contests"];
        for (size_t i = 0; i < arr.size(); i++)
            if (arr[i].value("id", 0) == cid2) { arr.erase(arr.begin() + (long)i); save_class_content(cid, cc); return respond(res, ok_j()); }
        fail(res, 404, "比赛不存在");
    });

    // POST /api/admin/class/{id}/training 创建训练
    svr.Post(R"(/api/admin/class/(\d+)/training)", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        string title = b.value("title", "");
        if (title.empty()) return fail(res, 400, "标题必填");
        auto probs = b.value("problems", json::array());
        string desc = b.value("description", "");
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& cdata = cc[to_string(cid)];
        int nid = 1;
        if (!cdata["trainings"].empty()) nid = cdata["trainings"].back().value("id", 0) + 1;
        cdata["trainings"].push_back({{"id", nid}, {"title", title},
                                       {"description", desc},
                                       {"problems", probs},
                                       {"created_at", b.value("created_at", "")}});
        save_class_content(cid, cc);
        respond(res, ok_j({{"id", nid}}));
    });

    // DELETE /api/admin/class/{id}/training/{tid}
    svr.Delete(R"(/api/admin/class/(\d+)/training/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str()); int tid = stoi(req.matches[2].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& arr = cc[to_string(cid)]["trainings"];
        for (size_t i = 0; i < arr.size(); i++)
            if (arr[i].value("id", 0) == tid) { arr.erase(arr.begin() + (long)i); save_class_content(cid, cc); return respond(res, ok_j()); }
        fail(res, 404, "训练不存在");
    });

    // POST /api/admin/class/{id}/homework 创建作业
    svr.Post(R"(/api/admin/class/(\d+)/homework)", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        string title = b.value("title", "");
        if (title.empty()) return fail(res, 400, "标题必填");
        auto probs = b.value("problems", json::array());
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& cdata = cc[to_string(cid)];
        int nid = 1;
        if (!cdata["homeworks"].empty()) nid = cdata["homeworks"].back().value("id", 0) + 1;
        cdata["homeworks"].push_back({{"id", nid}, {"title", title},
                                       {"problems", probs},
                                      {"deadline", b.value("deadline", "")},
                                      {"created_at", b.value("created_at", "")}});
        save_class_content(cid, cc);
        respond(res, ok_j({{"id", nid}}));
    });

    // DELETE /api/admin/class/{id}/homework/{hid}
    svr.Delete(R"(/api/admin/class/(\d+)/homework/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res); if (u.empty()) return;
        int cid = stoi(req.matches[1].str()); int hid = stoi(req.matches[2].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto cc = load_class_content(cid);
        auto& arr = cc[to_string(cid)]["homeworks"];
        for (size_t i = 0; i < arr.size(); i++)
            if (arr[i].value("id", 0) == hid) { arr.erase(arr.begin() + (long)i); save_class_content(cid, cc); return respond(res, ok_j()); }
        fail(res, 404, "作业不存在");
    });

    // ========== 商城 ==========
    svr.Get("/api/shop", [](const httplib::Request& req, httplib::Response& res) {
        auto sf = load_data("shop.json");
        respond(res, ok_j({{"items", sf.value("items", json::array())}}));
    });

    svr.Post("/api/shop/buy", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        int item_id = b.value("item_id", 0);
        lock_guard<mutex> lk(g_biz_mu);
        auto sf = load_data("shop.json");
        auto& items = sf["items"];
        json* it = nullptr;
        for (auto& x : items) if (x["id"].get<int>() == item_id) { it = &x; break; }
        if (!it) return fail(res, 404, "商品不存在");
        if (it->value("stock", -1) <= 0) return fail(res, 400, "库存不足，手慢无");
        int price = it->value("price", 0);
        int my_points = u["points"].get<int>();
        if (my_points < price) return fail(res, 400, "积分不足，先去刷几道题吧");
        g_db.query("UPDATE users SET points=points-" + to_string(price) +
                   " WHERE id=" + to_string(u["id"].get<long long>()));
        (*it)["stock"] = it->value("stock", 0) - 1;
        save_data("shop.json", sf);
        string iname = it->value("name", "");
        g_db.query("INSERT INTO purchases(user_id,item_id,item_name,price) VALUES(" +
                   to_string(u["id"].get<long long>()) + "," + to_string(item_id) +
                   ",'" + g_db.escape(iname) + "'," + to_string(price) + ")");
        respond(res, ok_j({{"item_name", iname}, {"points_left", my_points - price}}));
    });

    svr.Get("/api/shop/mine", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res);
        if (u.empty()) return;
        auto r = g_db.rows("SELECT item_name,price,created_at FROM purchases"
                           " WHERE user_id=" + to_string(u["id"].get<long long>()) +
                           " ORDER BY id DESC LIMIT 50");
        json list = json::array();
        for (auto& row : r)
            list.push_back({{"item_name", row[0]}, {"price", stoi(row[1])}, {"created_at", row[2]}});
        respond(res, ok_j({{"items", list}}));
    });

    // ========== 管理端：用户与角色 ==========
    svr.Get("/api/admin/users", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res); if (u.empty()) return;
        auto rows = g_db.rows("SELECT id,username,role,points,solved_count,created_at FROM users ORDER BY id ASC");
        json list = json::array();
        for (auto& r : rows) {
            list.push_back({{"id", stoll(r[0])}, {"username", r[1]}, {"role", r[2]},
                            {"points", stoi(r[3])}, {"solved", stoi(r[4])},
                            {"created_at", r[5]}});
        }
        respond(res, ok_j({{"users", list}}));
    });

    // 批量发放积分（admin）
    svr.Post("/api/admin/points/grant", [](const httplib::Request& req, httplib::Response& res) {
        auto me = require_admin(req, res); if (me.empty()) return;
        auto b = parse_body(req);
        int points = b.value("points", 0);
        if (points <= 0) return fail(res, 400, "积分必须大于 0");
        auto ids = b.value("user_ids", json::array());
        if (ids.empty()) return fail(res, 400, "请先勾选用户");
        if (ids.size() > 500) return fail(res, 400, "单次最多 500 人");
        for (auto& id : ids) {
            g_db.query("UPDATE users SET points=points+" + to_string(points) +
                       " WHERE id=" + to_string(id.get<long long>()));
        }
        respond(res, ok_j({{"granted", (int)ids.size()}, {"points", points}}));
    });

    // 超级管理员删除用户
    svr.Delete(R"(/api/admin/user/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto me = require_admin(req, res); if (me.empty()) return;
        long long uid = stoll(req.matches[1].str());
        if (uid == me["id"].get<long long>()) return fail(res, 400, "不能删除自己");
        // 检查目标用户
        auto cur = g_db.rows("SELECT role FROM users WHERE id=" + to_string(uid));
        if (cur.empty()) return fail(res, 404, "用户不存在");
        // 如果是唯一超级管理员，拒
        if (cur[0][0] == "admin") {
            auto cnt = g_db.rows("SELECT COUNT(*) FROM users WHERE role='admin' AND id<>" + to_string(uid));
            if (cnt.empty() || stoi(cnt[0][0]) == 0)
                return fail(res, 400, "不能删除最后一个超级管理员");
        }
        // 清理 sessions、submissions(保留下 user_id)、purchases、classes members
        g_db.query("DELETE FROM sessions WHERE user_id=" + to_string(uid));
        // 查询目标用户名
        string uname;
        auto urows = g_db.rows("SELECT username FROM users WHERE id=" + to_string(uid));
        if (!urows.empty()) uname = urows[0][0];
        // 解绑班级成员
        if (!uname.empty()) {
            lock_guard<mutex> lk(g_biz_mu);
            auto cf = load_data("classes.json");
            for (auto& c : cf["classes"]) {
                auto& mems = c["members"];
                for (size_t i = 0; i < mems.size(); i++) {
                    if (mems[i].is_string() && mems[i].get<string>() == uname) {
                        mems.erase(mems.begin() + (long)i);
                        break;
                    }
                }
            }
            save_data("classes.json", cf);
        }
        g_db.query("DELETE FROM users WHERE id=" + to_string(uid));
        respond(res, ok_j());
    });

    // 注销自己账号（超级管理员禁自杀）
    svr.Post("/api/account/delete", [](const httplib::Request& req, httplib::Response& res) {
        auto me = require_user(req, res); if (me.empty()) return;
        long long uid = me["id"].get<long long>();
        string role = me.value("role", "");
        if (role == "admin") return fail(res, 400, "超级管理员不能注销，请先转交权限");
        g_db.query("DELETE FROM sessions WHERE user_id=" + to_string(uid));
        // 从所有班级中移除
        string uname = me.value("username", "");
        if (!uname.empty()) {
            lock_guard<mutex> lk(g_biz_mu);
            auto cf = load_data("classes.json");
            for (auto& c : cf["classes"]) {
                auto& mems = c["members"];
                for (size_t i = 0; i < mems.size(); i++) {
                    if (mems[i].is_string() && mems[i].get<string>() == uname) {
                        mems.erase(mems.begin() + (long)i);
                        break;
                    }
                }
            }
            save_data("classes.json", cf);
        }
        g_db.query("DELETE FROM users WHERE id=" + to_string(uid));
        respond(res, ok_j());
    });

    svr.Post(R"(/api/admin/user/(\d+)/role)", [](const httplib::Request& req, httplib::Response& res) {

        auto me = require_admin(req, res); if (me.empty()) return;
        long long uid = stoll(req.matches[1].str());
        auto b = parse_body(req);
        string role = b.value("role", "");
        if (role != "user" && role != "admin" && role != "class_admin")
            return fail(res, 400, "角色必须是 user / admin / class_admin");
        // 保护：不能把最后一个超级管理员降级
        if (uid == me["id"].get<long long>() && role != "admin") {
            // 自己降级 → 检查还有别的 admin
            auto cnt = g_db.rows("SELECT COUNT(*) FROM users WHERE role='admin' AND id<>" + to_string(uid));
            if (cnt.empty() || stoi(cnt[0][0]) == 0)
                return fail(res, 400, "不能降级最后一个超级管理员");
        }
        // 保护：如果目标现在是唯一 admin 且降级 → 拒
        if (role != "admin") {
            auto cur = g_db.rows("SELECT role FROM users WHERE id=" + to_string(uid));
            if (!cur.empty() && cur[0][0] == "admin") {
                auto cnt = g_db.rows("SELECT COUNT(*) FROM users WHERE role='admin' AND id<>" + to_string(uid));
                if (cnt.empty() || stoi(cnt[0][0]) == 0)
                    return fail(res, 400, "不能降级最后一个超级管理员");
            }
        }
        g_db.query("UPDATE users SET role='" + g_db.escape(role) + "' WHERE id=" + to_string(uid));
        respond(res, ok_j());
    });

    // ========== 管理端：统计 ==========
    svr.Get("/api/admin/stats", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        auto n1 = g_db.rows("SELECT COUNT(*) FROM users");
        auto n2 = g_db.rows("SELECT COUNT(*) FROM submissions");
        auto n3 = g_db.rows("SELECT COUNT(*) FROM submissions WHERE status='AC'");
        auto pf = problems_file();
        respond(res, ok_j({{"users", n1.empty() ? 0 : stoll(n1[0][0])},
                           {"submissions", n2.empty() ? 0 : stoll(n2[0][0])},
                           {"accepted", n3.empty() ? 0 : stoll(n3[0][0])},
                           {"problems", (int)pf["problems"].size()}}));
    });

    // ========== 管理端：题目 ==========
    svr.Post("/api/admin/problem", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        string title = b.value("title", "");
        if (title.empty()) return fail(res, 400, "题目标题不能为空");
        auto pf = problems_file();
        auto& ps = pf["problems"];
        json p = {{"id", next_id(ps)},
                  {"title", title},
                  {"description", b.value("description", "")},
                  {"input_desc", b.value("input_desc", "")},
                  {"output_desc", b.value("output_desc", "")},
                  {"samples", b.value("samples", json::array())},
                  {"time_limit", b.value("time_limit", 1)},
                  {"memory_limit", b.value("memory_limit", 256)},
                  {"difficulty", b.value("difficulty", 1)},
                  {"tags", b.value("tags", json::array())},
                  {"testcases", b.value("testcases", json::array())}};
        ps.push_back(p);
        save_data("problems.json", pf);
        respond(res, ok_j({{"id", p["id"]}}));
    });

    svr.Put(R"(/api/admin/problem/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int pid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        auto pf = problems_file();
        auto& ps = pf["problems"];
        for (auto& p : ps) {
            if (p["id"].get<int>() != pid) continue;
            p["title"]        = b.value("title", p.value("title", ""));
            p["description"]  = b.value("description", p.value("description", ""));
            p["input_desc"]   = b.value("input_desc", p.value("input_desc", ""));
            p["output_desc"]  = b.value("output_desc", p.value("output_desc", ""));
            p["samples"]      = b.value("samples", p.value("samples", json::array()));
            p["time_limit"]   = b.value("time_limit", p.value("time_limit", 1));
            p["memory_limit"] = b.value("memory_limit", p.value("memory_limit", 256));
            p["difficulty"]   = b.value("difficulty", p.value("difficulty", 1));
            p["tags"]         = b.value("tags", p.value("tags", json::array()));
            p["testcases"]    = b.value("testcases", p.value("testcases", json::array()));
            save_data("problems.json", pf);
            return respond(res, ok_j());
        }
        fail(res, 404, "题目不存在");
    });

    svr.Delete(R"(/api/admin/problem/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int pid = stoi(req.matches[1].str());
        auto pf = problems_file();
        auto& ps = pf["problems"];
        for (size_t i = 0; i < ps.size(); i++) {
            if (ps[i]["id"].get<int>() == pid) {
                ps.erase(ps.begin() + (long)i);
                save_data("problems.json", pf);
                return respond(res, ok_j());
            }
        }
        fail(res, 404, "题目不存在");
    });

    // JSON 批量导入（兼容 {problems:[...]} 与裸数组）
    svr.Post("/api/admin/problems/import", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        json arr = b.contains("problems") ? b["problems"] : b;
        if (!arr.is_array() || arr.empty()) return fail(res, 400, "需要提供 problems 数组");
        lock_guard<mutex> lk(g_biz_mu);
        auto pf = problems_file();
        auto& ps = pf["problems"];
        int added = 0;
        for (auto& item : arr) {
            if (!item.contains("title")) continue;
            json p = {{"id", next_id(ps)},
                      {"title", item.value("title", "")},
                      {"description", item.value("description", "")},
                      {"input_desc", item.value("input_desc", "")},
                      {"output_desc", item.value("output_desc", "")},
                      {"samples", item.value("samples", json::array())},
                      {"time_limit", item.value("time_limit", 1)},
                      {"memory_limit", item.value("memory_limit", 256)},
                      {"difficulty", item.value("difficulty", 1)},
                      {"tags", item.value("tags", json::array())},
                      {"testcases", item.value("testcases", json::array())}};
            ps.push_back(p);
            added++;
        }
        save_data("problems.json", pf);
        respond(res, ok_j({{"added", added}}));
    });

    // ========== 管理端：公告 ==========
    svr.Post("/api/admin/announcement", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        string title = b.value("title", "");
        if (title.empty()) return fail(res, 400, "标题不能为空");
        lock_guard<mutex> lk(g_biz_mu);
        auto af = load_data("announcements.json");
        auto& anns = af["announcements"];
        anns.insert(anns.begin(), json{{"id", next_id(anns)},
                                   {"title", title},
                                   {"content", b.value("content", "")},
                                   {"created_at", b.value("created_at", "")}});
        save_data("announcements.json", af);
        respond(res, ok_j());
    });

    svr.Delete(R"(/api/admin/announcement/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int aid = stoi(req.matches[1].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto af = load_data("announcements.json");
        auto& anns = af["announcements"];
        for (size_t i = 0; i < anns.size(); i++)
            if (anns[i]["id"].get<int>() == aid) {
                anns.erase(anns.begin() + (long)i);
                save_data("announcements.json", af);
                return respond(res, ok_j());
            }
        fail(res, 404, "公告不存在");
    });

    // ========== 网盘 ==========
    // 文件存 DATA_DIR/files/{id}.bin，元数据存 DATA_DIR/files.json
    {
        static std::random_device file_rd;
        // 注意：files_dir 必须是 static，避免闭包块结束析构后悬垂引用
        static const std::string files_dir = std::string(DATA_DIR) + "/files";
        auto gen_file_id = [&]() {
            std::stringstream ss;
            for (int i = 0; i < 16; i++) ss << std::hex << (file_rd() % 256);
            return ss.str();
        };
        auto load_files = [&]() {
            auto f = load_data("files.json");
            if (!f.contains("files")) f["files"] = json::array();
            return f;
        };

        svr.Post("/api/files/upload", [&files_dir, &gen_file_id, &load_files](const httplib::Request& req, httplib::Response& res) {
            auto u = require_user(req, res); if (u.empty()) return;
            if (!req.has_file("file")) return fail(res, 400, "未选择文件");
            const auto& f = req.get_file_value("file");
            string role = u.value("role", "");
            long long MAX = (role == "admin") ? (long long)1024 * 1024 * 1024 : 20LL * 1024 * 1024;  // admin 1GB, 普通 20MB
            if ((long long)f.content.size() > MAX) {
                string msg = string("文件太大（") + to_string(f.content.size()/1024/1024) + "MB），上限 " + (role == "admin" ? "1GB" : "20MB");
                return fail(res, 400, msg);
            }
            // 总磁盘配额：普通 200MB，admin 2GB
            long long QUOTA = (role == "admin") ? 2LL * 1024 * 1024 * 1024 : 200LL * 1024 * 1024;
            long long used = 0;
            auto cf2 = load_files();
            for (auto& f2 : cf2.value("files", json::array())) used += f2["size"].get<long long>();
            if (used + (long long)f.content.size() > QUOTA) {
                string msg = string("总空间超限（已用 ") + to_string(used/1024/1024) + "MB），上限 " + (role == "admin" ? "2GB" : "200MB");
                return fail(res, 400, msg);
            }
            mkdirs(files_dir);
            string fid = gen_file_id();
            string path = files_dir + "/" + fid;
            std::ofstream out(path, std::ios::binary);
            if (!out) return fail(res, 500, "写入失败");
            out.write(f.content.data(), f.content.size());
            out.flush();
            out.close();
            // 写元数据
            auto mf = load_files();
            time_t now = time(nullptr); struct tm tm; localtime_r(&now, &tm);
            char ts[32]; strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", &tm);
            mf["files"].push_back({
                {"id", fid}, {"filename", f.filename},
                {"size", (long long)f.content.size()},
                {"uploaded_by", u["username"]},
                {"uploaded_at", ts},
                {"downloads", 0}
            });
            save_data("files.json", mf);
            respond(res, ok_j({{"id", fid}, {"filename", f.filename}, {"size", (long long)f.content.size()}}));
        });

        svr.Get("/api/files", [&load_files](const httplib::Request& req, httplib::Response& res) {
            auto u = current_user(req);
            auto mf = load_files();
            // 统计已用空间
            long long used = 0;
            for (auto& f : mf.value("files", json::array())) used += f["size"].get<long long>();
            string role = u.is_object() ? u.value("role", "user") : "user";
            long long quota = (role == "admin") ? 2LL * 1024 * 1024 * 1024 : 200LL * 1024 * 1024;
            long long singleMax = (role == "admin") ? 1024LL * 1024 * 1024 : 20LL * 1024 * 1024;
            respond(res, ok_j({{"files", mf["files"]},
                               {"used", used}, {"quota", quota},
                               {"single_max", singleMax}, {"role", role}}));
        });

        svr.Get(R"(/api/files/(\w+)/download)", [&load_files](const httplib::Request& req, httplib::Response& res) {
            string fid = req.matches[1].str();
            auto mf = load_files();
            for (auto& f : mf["files"]) {
                if (f.value("id", "") != fid) continue;
                string path = DATA_DIR + "/files/" + fid;
                std::ifstream in(path, std::ios::binary);
                if (!in) return fail(res, 404, "文件丢失");
                std::stringstream ss; ss << in.rdbuf();
                // 下载次数+1
                f["downloads"] = f["downloads"].get<int>() + 1;
                save_data("files.json", mf);
                // 处理中文文件名：URL encode + RFC 5987
                string name = f.value("filename", fid);
                string safe_name; for (char c : name) { if (c < 0x20 || c == '"' || c == '\\') c = '_'; safe_name += c; }
                string encoded = "";
                for (unsigned char c : name) {
                    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') encoded += c;
                    else { char buf[8]; snprintf(buf, sizeof(buf), "%%%02X", c); encoded += buf; }
                }
                res.set_header("Content-Disposition",
                    "attachment; filename=\"" + safe_name + "\"; filename*=UTF-8''" + encoded);
                res.set_content(ss.str(), "application/octet-stream");
                return;
            }
            fail(res, 404, "文件不存在");
        });

        svr.Delete(R"(/api/files/(\w+))", [&load_files](const httplib::Request& req, httplib::Response& res) {
            auto u = require_user(req, res); if (u.empty()) return;
            string fid = req.matches[1].str();
            auto mf = load_files();
            auto& files = mf["files"];
            for (size_t i = 0; i < files.size(); i++) {
                if (files[i].value("id", "") != fid) continue;
                string role = u.value("role", "");
                string uname = u.value("username", "");
                if (files[i].value("uploaded_by", "") != uname && role != "admin")
                    return fail(res, 403, "只能删除自己上传的文件");
                remove((DATA_DIR + "/files/" + fid).c_str());
                files.erase(files.begin() + (long)i);
                save_data("files.json", mf);
                return respond(res, ok_j());
            }
            fail(res, 404, "文件不存在");
        });
    }

    // ========== AI 助手（用户自带 API Key，多平台） ==========
    struct AiProv { string name, base, path, model; };
    const AiProv AI_PROVIDERS[] = {
        {"deepseek", "https://api.deepseek.com", "/chat/completions", "deepseek-chat"},
        {"minimax",  "https://api.minimaxi.com", "/v1/text/chatcompletion_v2", "abab6.5s-chat"},
    };
    auto ai_prov = [&](const string& p, AiProv& out) {
        for (auto& pr : AI_PROVIDERS) if (pr.name == p) { out = pr; return true; }
        return false;
    };

    // 查询是否已配置 AI key（不返回 key 本体）+ 当前平台
    svr.Get("/api/ai/status", [&ai_prov](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res); if (u.empty()) return;
        auto rows = g_db.rows("SELECT ai_api_key, ai_provider FROM users WHERE id=" + to_string(u["id"].get<long long>()));
        string key = rows.empty() ? "" : rows[0][0];
        string prov = rows.empty() ? "deepseek" : rows[0][1];
        AiProv pv; string model = ""; if (ai_prov(prov, pv)) model = pv.model;
        json st = {{"configured", !key.empty()}, {"provider", prov}, {"model", model}};
        respond(res, ok_j(st));
    });

    // 保存/清空用户自己的 API Key（自动识别平台：sk-开头=DeepSeek，否则=MiniMax）
    svr.Patch("/api/ai/key", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res); if (u.empty()) return;
        auto b = parse_body(req);
        string key = b.value("api_key", "");
        if (key.size() > 256) key = key.substr(0, 256);
        string prov = "minimax";
        if (key.rfind("sk-", 0) == 0 || key.rfind("SK-", 0) == 0) prov = "deepseek";
        g_db.query("UPDATE users SET ai_api_key='" + g_db.escape(key) +
                   "', ai_provider='" + g_db.escape(prov) +
                   "' WHERE id=" + to_string(u["id"].get<long long>()));
        json r2 = {{"configured", !key.empty()}, {"provider", prov}};
        respond(res, ok_j(r2));
    });

    // AI 对话（费用走用户自己的 key，按平台调用）
    svr.Post("/api/ai/chat", [&ai_prov](const httplib::Request& req, httplib::Response& res) {
        auto u = require_user(req, res); if (u.empty()) return;
        auto b = parse_body(req);
        string msg = b.value("message", "");
        if (msg.empty()) return fail(res, 400, "消息不能为空");
        if (msg.size() > 4000) return fail(res, 400, "消息过长（≤4000 字）");
        auto rows = g_db.rows("SELECT ai_api_key, ai_provider FROM users WHERE id=" + to_string(u["id"].get<long long>()));
        string api_key = rows.empty() ? "" : rows[0][0];
        string prov = rows.empty() ? "" : rows[0][1];
        if (api_key.empty()) return fail(res, 400, "请先在【个人主页→设置】里填入你自己的 API Key");
        AiProv pv; if (!ai_prov(prov, pv)) return fail(res, 400, "未知 AI 平台");
        // 组装请求体（OpenAI 兼容 messages 格式）
        json sys_msg = {{"role", "system"}, {"content", "你是比特 OJ 的 AI 助手，帮助 C++ 学习者解答编程问题。回答简洁清晰，可以给代码示例。"}};
        json usr_msg = {{"role", "user"}, {"content", msg}};
        json msgs = json::array(); msgs.push_back(sys_msg); msgs.push_back(usr_msg);
        json payload = {{"model", pv.model}, {"stream", false}, {"messages", msgs}};
        httplib::Result r;
        try {
            httplib::Client cli(pv.base);
            cli.set_connection_timeout(10, 0);
            cli.set_read_timeout(120, 0);
            httplib::Headers hdrs = {{"Content-Type", "application/json"},
                                    {"Authorization", "Bearer " + api_key}};
            r = cli.Post(pv.path, hdrs, payload.dump(), "application/json");
        } catch (const std::exception& e) {
            return fail(res, 502, string("AI 调用异常: ") + e.what());
        } catch (...) {
            return fail(res, 502, "AI 调用异常(未知)");
        }
        if (!r) return fail(res, 502, "AI 服务不可达");
        json respj;
        try { respj = json::parse(r->body); } catch (...) { return fail(res, 502, "AI 返回异常"); }
        if (r->status != 200) {
            string em = respj.value("error", json::object()).value("message", "AI 错误");
            if (em.empty()) em = "AI 返回 " + to_string(r->status);
            return fail(res, 502, em);
        }
        auto choices = respj.value("choices", json::array());
        if (choices.empty()) return fail(res, 502, "AI 无返回");
        string reply = choices[0].value("message", json::object()).value("content", "");
        if (reply.empty()) {
            // MiniMax 的 chatcompletion_v2 用 "reply" 字段
            reply = choices[0].value("reply", "");
        }
        long long used = respj.value("usage", json::object()).value("total_tokens", 0);
        json chat_r = {{"reply", reply}, {"used", used}, {"provider", prov}};
        respond(res, ok_j(chat_r));
    });

    // ========== 管理端：训练 ==========
    svr.Post("/api/admin/training", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        string title = b.value("title", "");
        if (title.empty()) return fail(res, 400, "训练名不能为空");
        lock_guard<mutex> lk(g_biz_mu);
        auto tf = load_data("trainings.json");
        auto& ts = tf["trainings"];
        ts.insert(ts.begin(), json{{"id", next_id(ts)},
                               {"title", title},
                               {"description", b.value("description", "")},
                               {"problem_ids", b.value("problem_ids", json::array())},
                               {"created_at", b.value("created_at", "")}});
        save_data("trainings.json", tf);
        respond(res, ok_j());
    });

    svr.Delete(R"(/api/admin/training/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int tid = stoi(req.matches[1].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto tf = load_data("trainings.json");
        auto& ts = tf["trainings"];
        for (size_t i = 0; i < ts.size(); i++)
            if (ts[i]["id"].get<int>() == tid) {
                ts.erase(ts.begin() + (long)i);
                save_data("trainings.json", tf);
                return respond(res, ok_j());
            }
        fail(res, 404, "训练不存在");
    });

    // ========== 管理端：班级 ==========
    svr.Post("/api/admin/class", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_class_admin(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        string name = b.value("name", "");
        if (name.empty()) return fail(res, 400, "班级名不能为空");
        lock_guard<mutex> lk(g_biz_mu);
        auto cf = load_data("classes.json");
        auto& cs = cf["classes"];
        cs.insert(cs.begin(), json{{"id", next_id(cs)},
                               {"name", name},
                               {"description", b.value("description", "")},
                               {"invite_code", b.value("invite_code", "")},
                               {"members", json::array()},
                               {"created_at", b.value("created_at", "")}});
        save_data("classes.json", cf);
        respond(res, ok_j());
    });

    svr.Delete(R"(/api/admin/class/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int cid = stoi(req.matches[1].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto cf = load_data("classes.json");
        auto& cs = cf["classes"];
        for (size_t i = 0; i < cs.size(); i++)
            if (cs[i]["id"].get<int>() == cid) {
                cs.erase(cs.begin() + (long)i);
                save_data("classes.json", cf);
                return respond(res, ok_j());
            }
        fail(res, 404, "班级不存在");
    });

    // ========== 管理端：商城 ==========
    svr.Post("/api/admin/shop-item", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        auto b = parse_body(req);
        string name = b.value("name", "");
        if (name.empty()) return fail(res, 400, "商品名不能为空");
        lock_guard<mutex> lk(g_biz_mu);
        auto sf = load_data("shop.json");
        auto& items = sf["items"];
        items.push_back(json{{"id", next_id(items)},
                         {"name", name},
                         {"description", b.value("description", "")},
                         {"price", b.value("price", 0)},
                         {"icon", b.value("icon", "🎁")},
                         {"stock", b.value("stock", 0)}});
        save_data("shop.json", sf);
        respond(res, ok_j());
    });

    svr.Put(R"(/api/admin/shop-item/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int iid = stoi(req.matches[1].str());
        auto b = parse_body(req);
        lock_guard<mutex> lk(g_biz_mu);
        auto sf = load_data("shop.json");
        auto& items = sf["items"];
        for (auto& it : items) {
            if (it["id"].get<int>() != iid) continue;
            it["name"]        = b.value("name", it.value("name", ""));
            it["description"] = b.value("description", it.value("description", ""));
            it["price"]       = b.value("price", it.value("price", 0));
            it["icon"]        = b.value("icon", it.value("icon", "🎁"));
            it["stock"]       = b.value("stock", it.value("stock", 0));
            save_data("shop.json", sf);
            return respond(res, ok_j());
        }
        fail(res, 404, "商品不存在");
    });

    svr.Delete(R"(/api/admin/shop-item/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        auto u = require_admin(req, res);
        if (u.empty()) return;
        int iid = stoi(req.matches[1].str());
        lock_guard<mutex> lk(g_biz_mu);
        auto sf = load_data("shop.json");
        auto& items = sf["items"];
        for (size_t i = 0; i < items.size(); i++)
            if (items[i]["id"].get<int>() == iid) {
                items.erase(items.begin() + (long)i);
                save_data("shop.json", sf);
                return respond(res, ok_j());
            }
        fail(res, 404, "商品不存在");
    });
}

// ---------------- 入口 ----------------
int main() {
    mkdirs("data");
    mkdirs(TEMP_DIR);
    mkdirs("logs");

    // 读取配置（可缺省）
    json cfg = store::load("server/config.json");
    string host = cfg.value("host", "0.0.0.0");
    int port   = cfg.value("port", 8080);
    string dbh = cfg.value("db_host", "127.0.0.1");
    int dbp    = cfg.value("db_port", 3306);
    string dbu = cfg.value("db_user", "root");
    string dbpwd = cfg.value("db_password", "");
    string dbn   = cfg.value("db_name", "oj");

    if (!g_db.connect(dbh, dbp, dbu, dbpwd, dbn)) {
        fprintf(stderr, "[oj] MySQL 连接失败，请检查 server/config.json 与数据库状态\n");
        return 1;
    }

    // 自动创建管理员 admin / admin123
    g_db.query("CREATE TABLE IF NOT EXISTS sessions ("
               "token VARCHAR(64) PRIMARY KEY, username VARCHAR(64) NOT NULL,"
               "role VARCHAR(20) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"
               "last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"
               "INDEX idx_user(username), INDEX idx_seen(last_seen)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    auto adm = g_db.rows("SELECT id FROM users WHERE username='admin'");
    if (adm.empty()) {
        g_db.query("INSERT INTO users(username,password,role) VALUES('admin','" +
                   Auth::sha256("admin123") + "','admin')");
        printf("[oj] 已创建管理员账号 admin / admin123\n");
    }

    // schema 自动迁移：role 字段加 class_admin
    g_db.query("ALTER TABLE users MODIFY COLUMN role ENUM('user','admin','class_admin') NOT NULL DEFAULT 'user'");
    // schema 自动迁移：users 加 signature 字段（个性化签名）
    {
        auto chk = g_db.rows("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS"
                              " WHERE TABLE_SCHEMA='oj' AND TABLE_NAME='users' AND COLUMN_NAME='signature'");
        if (!chk.empty() && chk[0][0] == "0")
            g_db.query("ALTER TABLE users ADD COLUMN signature VARCHAR(200) NOT NULL DEFAULT ''");
    }
    // schema 自动迁移：users 加 ai_api_key（用户自己填的 API Key）
    {
        auto chk = g_db.rows("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS"
                              " WHERE TABLE_SCHEMA='oj' AND TABLE_NAME='users' AND COLUMN_NAME='ai_api_key'");
        if (!chk.empty() && chk[0][0] == "0")
            g_db.query("ALTER TABLE users ADD COLUMN ai_api_key VARCHAR(256) NOT NULL DEFAULT ''");
    }
    // schema 自动迁移：users 加 ai_provider（ai 平台：deepseek / minimax）
    {
        auto chk = g_db.rows("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS"
                              " WHERE TABLE_SCHEMA='oj' AND TABLE_NAME='users' AND COLUMN_NAME='ai_provider'");
        if (!chk.empty() && chk[0][0] == "0")
            g_db.query("ALTER TABLE users ADD COLUMN ai_provider VARCHAR(32) NOT NULL DEFAULT 'deepseek'");
    }
    // schema 自动迁移：题目笔记表 user_notes
    g_db.query("CREATE TABLE IF NOT EXISTS user_notes ("
               "user_id BIGINT NOT NULL,"
               "problem_id INT NOT NULL,"
               "content MEDIUMTEXT NOT NULL,"
               "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,"
               "PRIMARY KEY (user_id, problem_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    httplib::Server svr;
    svr.set_mount_point("/", "static");   // 前端静态文件
    register_routes(svr);

    printf("[oj] 比特 OJ 启动: http://%s:%d  (题库=%s, 临时=%s)\n",
           host.c_str(), port, DATA_DIR.c_str(), TEMP_DIR.c_str());
    fflush(stdout);

    if (!svr.listen(host.c_str(), port)) {
        fprintf(stderr, "[oj] 监听失败（端口被占用？）\n");
        return 1;
    }
    return 0;
}