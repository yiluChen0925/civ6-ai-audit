package com.civ.eval;

import com.civ.eval.analyzer.TurnComparator;
import com.civ.eval.loader.TurnDataLoader;
import com.civ.eval.model.TurnData;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class ApiServer {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 数据目录：优先 -Dciv6.eval.dataDir，其次环境变量 CIV6_DATA_DIR，
     * 默认取「当前工作目录/data/collected」——所以请在项目根目录下启动，别再写死个人绝对路径。
     */
    static String resolveDataDir() {
        String prop = System.getProperty("civ6.eval.dataDir");
        if (prop != null && !prop.isBlank()) return prop;
        String env = System.getenv("CIV6_DATA_DIR");
        if (env != null && !env.isBlank()) return env;
        return java.nio.file.Paths.get("data", "collected").toString();
    }

    public static void main(String[] args) throws Exception {
        String dataDir = resolveDataDir();
        HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);

        // ===== 接口1：获取某回合的对比分析 =====
        server.createContext("/api/analysis", exchange -> {
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            try {
                String query = exchange.getRequestURI().getQuery();
                int turnNum = 39;
                if (query != null && query.startsWith("turn=")) {
                    turnNum = Integer.parseInt(query.substring(5));
                }

                Map<Integer, TurnData> turns = TurnDataLoader.loadAll(dataDir);
                TurnData current = turns.get(turnNum);
                TurnData next = turns.get(turnNum + 1);

                if (current == null) {
                    sendJson(exchange, 404, Map.of("error", "turn not found: " + turnNum));
                    return;
                }

                Map<String, Object> result = new LinkedHashMap<>();
                result.put("turn", turnNum);
                result.put("planning", current.reflections != null ? current.reflections.planning : "");
                result.put("hypothesis", current.reflections != null ? current.reflections.hypothesis : "");
                result.put("unitChanges", TurnComparator.getUnitChanges(current, next));
                result.put("cityChange", TurnComparator.getCityChange(current, next));

                sendJson(exchange, 200, result);
            } catch (Exception e) {
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        });

        // ===== 接口2：获取所有回合列表 =====
        server.createContext("/api/turns", exchange -> {
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            try {
                Map<Integer, TurnData> turns = TurnDataLoader.loadAll(dataDir);
                List<Integer> turnNums = new ArrayList<>(turns.keySet());
                Collections.sort(turnNums);
                sendJson(exchange, 200, Map.of("turns", turnNums));
            } catch (Exception e) {
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        });

        // ===== 接口3：获取所有回合的完整数据 =====
        server.createContext("/api/all", exchange -> {
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            try {
                Map<Integer, TurnData> turns = TurnDataLoader.loadAll(dataDir);
                sendJson(exchange, 200, turns);
            } catch (Exception e) {
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        });

        server.setExecutor(null);
        server.start();
        System.out.println("✅ API 服务已启动: http://localhost:8080");
        System.out.println("   → 回合列表: http://localhost:8080/api/turns");
        System.out.println("   → 单回合分析: http://localhost:8080/api/analysis?turn=39");
    }

    private static void sendJson(com.sun.net.httpserver.HttpExchange exchange,
                                 int status, Object data) throws java.io.IOException {
        byte[] bytes = MAPPER.writeValueAsBytes(data);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
