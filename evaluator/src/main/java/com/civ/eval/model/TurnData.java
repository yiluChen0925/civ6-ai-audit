package com.civ.eval.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class TurnData {
    public int turn;
    public String timestamp;
    public String game;
    public List<CityInfo> cities = new ArrayList<>();
    public List<UnitInfo> units = new ArrayList<>();
    public Reflections reflections;

    /** 找到指定 pid 的城市 */
    public CityInfo findCityByPid(int pid) {
        return cities.stream()
                .filter(c -> c.pid == pid)
                .findFirst()
                .orElse(null);
    }

    /** 把 units 列表转成 {id: UnitInfo} 的 Map */
    public java.util.Map<Integer, UnitInfo> unitsById() {
        java.util.Map<Integer, UnitInfo> map = new java.util.HashMap<>();
        for (UnitInfo u : units) {
            map.put(u.id, u);
        }
        return map;
    }
}