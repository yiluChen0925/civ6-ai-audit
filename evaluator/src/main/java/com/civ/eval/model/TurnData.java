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
    public List<PlayerInfo> players = new ArrayList<>();
    public Reflections reflections;

    /** 找到指定 pid 的城市 */
    public CityInfo findCityByPid(int pid) {
        return cities.stream()
                .filter(c -> c.pid == pid)
                .findFirst()
                .orElse(null);
    }

    /** 找到指定 pid 的玩家 */
    public PlayerInfo findPlayerByPid(int pid) {
        return players.stream()
                .filter(p -> p.pid == pid)
                .findFirst()
                .orElse(null);
    }

    /** 我方（pid=0）的全部城市——城市检查别只看第一座 */
    public List<CityInfo> findCitiesByPid(int pid) {
        return cities.stream()
                .filter(c -> c.pid == pid)
                .collect(java.util.stream.Collectors.toList());
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