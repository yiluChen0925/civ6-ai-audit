package com.civ.eval.loader;

import com.civ.eval.model.TurnData;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class TurnDataLoader {

    private static final Pattern FILE_PATTERN = Pattern.compile("turn_(\\d+)\\.json");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 加载所有 turn_XXX.json 文件，返回按回合号排序的 Map
     */
    public static Map<Integer, TurnData> loadAll(String dataDir) throws Exception {
        Path dir = Paths.get(dataDir);
        File[] files = dir.toFile().listFiles();
        if (files == null) {
            throw new RuntimeException("目录不存在或为空: " + dataDir);
        }

        Map<Integer, TurnData> result = new TreeMap<>();
        for (File f : files) {
            Matcher m = FILE_PATTERN.matcher(f.getName());
            if (!m.matches()) continue;

            int turnNum = Integer.parseInt(m.group(1));
            TurnData data = MAPPER.readValue(f, TurnData.class);
            result.put(turnNum, data);
        }
        return result;
    }
}
