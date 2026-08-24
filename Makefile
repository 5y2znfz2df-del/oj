# =============================================
# 比特 OJ - 构建脚本
# 用法: make deps && make
# =============================================
CXX      = g++
CXXFLAGS = -O2 -std=c++17 -Wall -Iserver -I/usr/include/mysql
LDFLAGS  = -lmysqlclient -lcrypto -pthread

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