package com.civ.eval;

import com.civ.eval.analyzer.TurnComparator;
import com.civ.eval.loader.TurnDataLoader;
import com.civ.eval.model.TurnData;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class Main {

    public static void main(String[] args) throws Exception {
        String DATA_DIR = ApiServer.resolveDataDir();
        System.out.println("加载数据目录: " + DATA_DIR);

        Map<Integer, TurnData> turns = TurnDataLoader.loadAll(DATA_DIR);
        System.out.println("加载了 " + turns.size() + " 个回合: " + turns.keySet());

        List<Integer> turnNums = new ArrayList<>(turns.keySet());
        for (int i = 0; i < turnNums.size() - 1; i++) {
            TurnData current = turns.get(turnNums.get(i));
            TurnData next = turns.get(turnNums.get(i + 1));
            TurnComparator.compare(turnNums.get(i), current, next);
        }
    }
}
