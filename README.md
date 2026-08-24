# 🤖 比特 OJ — 在线评测系统

一个由爸爸钦点、比特亲手写的完整 OJ 项目：**C++ 后端 + 原生前端 SPA + MySQL + JSON 文件存储**。

## ✨ 功能一览

| 模块 | 说明 |
|------|------|
| 题库 | 题目列表、详情、难度/标签、AC 状态打勾 |
| 提单 | 提交代码 → 实时判题（AC/WA/TLE/RE/CE），含耗时/内存 |
| 排行榜 | 按 AC 题数 + 积分排名，前三名领奖台 🥇🥈🥉 |
| 训练 | 管理员挂训练计划，包含题目清单 |
| 公告 | 管理员发布/删除，首页可见 |
| 班级 | 管理员建班 + 邀请码，用户加入/退出 |
| 商城 | 积分买小玩意，首 AC 一题 +10 分 |
| 登录/注册 | 模态框弹窗，双 Tab 切换，未登录自动弹窗 |
| 管理后台 | 题目增删改 + **JSON 批量导入** + 公告/训练/班级/商城管理 |

**代码编辑器（硬性要求全满足）**：Monaco Editor · 字体 Consolas · `autoIndent: 'full'` 回车自动缩进。

## 📁 目录结构

```
oj/
├── Makefile                 # 构建脚本（make deps && make）
├── run.sh                   # nohup 启停脚本（start/stop/restart/status）
├── README.md
├── server/                  # C++ 后端
│   ├── main.cpp             # 主服务：路由 + 业务逻辑
│   ├── db.cpp / db.h        # MySQL 封装
│   ├── store.cpp / store.h  # JSON 文件存储（原子写入）
│   ├── auth.cpp / auth.h    # SHA256 密码 + 会话 token
│   ├── judge.cpp / judge.h  # 判题核心（fork + setrlimit 沙箱）
│   ├── httplib.h            # 依赖：cpp-httplib（make deps 自动下载）
│   ├── json.hpp             # 依赖：nlohmann/json（make deps 自动下载）
│   └── config.json          # 运行配置（端口/MySQL）
├── static/                  # 前端
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js, api.js, modal.js, editor.js
├── data/                    # JSON 数据（题库/训练/公告/班级/商城）
├── temp/                    # 判题编译临时目录（自动清理）
├── logs/                    # 运行日志
├── scripts/init_db.sql      # MySQL 建库脚本
└── deploy/oj.service        # systemd 服务示例
```

## 🚀 快速开始（Ubuntu / Debian）

### 1. 安装依赖

```bash
sudo apt update
sudo apt install -y g++ make curl libmysqlclient-dev libssl-dev mysql-server
```

### 2. 初始化数据库

```bash
sudo mysql -u root < scripts/init_db.sql
```

### 3. 配置数据库连接

编辑 `server/config.json`，填上你的 MySQL 账号密码：

```json
{
  "host": "0.0.0.0",
  "port": 8080,
  "db_host": "127.0.0.1",
  "db_port": 3306,
  "db_user": "root",
  "db_password": "你的密码",
  "db_name": "oj"
}
```

> 也可以把配置写成相对路径，服务启动时读取；缺省用默认值。

### 4. 编译

```bash
make deps      # 首次自动下载 httplib.h 和 json.hpp（CDN，失败自动回退 GitHub）
make           # 编译出 server/oj_server
```

### 5. 启动

```bash
./run.sh start          # nohup 后台运行
./run.sh status         # 查看状态
./run.sh stop           # 停止
tail -f logs/server.log # 看日志
```

浏览器打开 `http://<服务器IP>:8080` 即可。

### 6. systemd 方式（可选）

```bash
sudo cp deploy/oj.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oj
```

> 记得修改 `oj.service` 里的 `WorkingDirectory` / `ExecStart` 路径，并确保服务用户对 `temp/ data/ logs/` 有写权限。

## 🔑 管理员账号

服务**首次启动自动创建**：`admin` / `admin123`（赶紧登录后改个密码）。

## 📦 题目 JSON 批量导入

管理后台 → 题目管理 → 粘贴 JSON → 导入。格式（`problems` 数组或裸数组均可）：

```json
{
  "problems": [
    {
      "title": "A+B Problem",
      "description": "输入两个整数输出和",
      "input_desc": "一行两个整数",
      "output_desc": "一个整数",
      "samples": [{ "input": "1 2", "output": "3" }],
      "time_limit": 1,
      "memory_limit": 256,
      "difficulty": 1,
      "tags": ["入门"],
      "testcases": [
        { "input": "1 2\n", "output": "3\n" },
        { "input": "100 200\n", "output": "300\n" }
      ]
    }
  ]
}
```

**testcases 是判题数据，必须带**（`\n` 是真实换行）。已内置 3 道题：A+B、三柱汉诺塔、四柱汉诺塔Ⅲ（爸爸最近刷的题 😎）。

## 🗄 数据存储分工

| 数据 | 存储 |
|------|------|
| 用户、提交记录、购买记录 | MySQL（users / submissions / purchases） |
| 题库、训练、公告、班级、商城 | JSON 文件（data/*.json） |

> 判题的测试点存在 `problems.json` 的 `testcases` 里，普通用户通过 API 拿不到（管理员可见，方便编辑）。

## ⚙️ 判题机制

1. 提交代码落盘到 `temp/sub_xxx/main.cpp`
2. `g++ -O2 -std=c++17` 编译，失败 → **CE**（返回编译错误）
3. 逐测试点运行：`fork` + `setrlimit` 限制 **CPU 时间 / 内存(RLIMIT_AS) / 输出大小(64MB)**
4. 超时直接 `SIGKILL` → **TLE**；崩溃/非零退出 → **RE**（含 MLE）
5. 输出与标准答案做**宽松比对**（忽略行尾空白、末尾空行）→ **AC / WA**
6. 首 AC 自动 +10 积分，排行榜实时刷新

## 🔒 安全提示（重要）

- 判题进程直接以服务用户身份运行，**生产环境请用独立低权限用户 + systemd 部署**，不要用 root
- 更严格的隔离（容器/sandbox）属于进阶课题，教学部署这样够用
- 默认管理员密码要改；MySQL 不要用弱密码
- `temp/` 只放判题垃圾，重启服务时可清空

## 🛠 常用 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/register · /api/login · /api/logout | 认证（Bearer token） |
| GET | /api/problems · /api/problems/:id | 题库 |
| POST | /api/submit | 提交代码判题 |
| GET | /api/submissions?all=1 | 提交记录（admin 看全部） |
| GET | /api/ranklist | 排行榜 |
| GET | /api/trainings · /api/announcements · /api/classes · /api/shop | 各模块 |
| POST | /api/classes/join · /api/shop/buy | 加入班级 / 购买 |
| POST/PUT/DELETE | /api/admin/* | 管理端（见 server/main.cpp） |

---

刷题愉快，早日二级！—— 比特 🤖