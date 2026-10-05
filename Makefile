# =============================================
# 比特 OJ - 构建脚本
# 用法: make deps && make
# =============================================
CXX      = g++
# Mac 兼容：自动探测 mysql_config（Linux 上默认为 /usr/bin/mysql_config）
MYSQL_CONFIG ?= $(shell command -v mysql_config || echo /Users/fuxiang/mysql/bin/mysql_config)
MYSQL_CFLAGS := $(shell $(MYSQL_CONFIG) --include 2>/dev/null)
# 兼容 <mysql/mysql.h> 写法：剥掉 include 路径尾部的 /mysql（macOS 包头文件平铺，Linux 在 mysql/ 子目录）
MYSQL_CFLAGS := $(MYSQL_CFLAGS:/mysql=)
MYSQL_LIBS   := $(shell $(MYSQL_CONFIG) --libs 2>/dev/null)
CXXFLAGS = -O2 -std=c++17 -Wall -Iserver $(MYSQL_CFLAGS)
LDFLAGS  = $(MYSQL_LIBS) -pthread

SRCS = server/main.cpp server/db.cpp server/store.cpp server/auth.cpp server/judge.cpp
OBJS = $(SRCS:.cpp=.o)
TARGET = server/oj_server

all: deps $(TARGET)

# 下载两个单头文件依赖（仅首次需要；主源 jsdelivr CDN，失败则回退 GitHub）
deps:
	@if [ ! -f server/httplib.h ]; then \
		echo "[deps] 下载 cpp-httplib ..."; \
		curl -fsSL https://cdn.jsdelivr.net/gh/yhirose/cpp-httplib@v0.18.0/httplib.h -o server/httplib.h \
		|| curl -fsSL https://raw.githubusercontent.com/yhirose/cpp-httplib/master/httplib.h -o server/httplib.h; \
	fi
	@if [ ! -f server/json.hpp ]; then \
		echo "[deps] 下载 nlohmann/json ..."; \
		curl -fsSL https://cdn.jsdelivr.net/gh/nlohmann/json@v3.11.3/single_include/nlohmann/json.hpp -o server/json.hpp \
		|| curl -fsSL https://raw.githubusercontent.com/nlohmann/json/develop/single_include/nlohmann/json.hpp -o server/json.hpp; \
	fi
	@echo "[deps] 依赖就绪"

$(TARGET): $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $(OBJS) $(LDFLAGS)
	@echo "[build] 编译完成 -> $(TARGET)"

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(OBJS) $(TARGET)
	rm -rf temp/*

.PHONY: all deps run clean