package com.civ.eval.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 一个玩家的快照。
 *
 * 注意：这份数据里的 is_agent 字段**全是 false**，不能用来判断谁是我方；
 * 我方标识以 pid=0 为准（102 个回合都在，且 pid=0 的城市正是我方那三座）。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class PlayerInfo {
    public int pid;
    public String civ;
    public String leader;
    public double gold;
    public double gold_per_turn;
    public int techs_completed;
    public int civics_completed;
    public int cities;
    public int pop;
    public int units_total;
    public int score;
    public String era;
    public boolean is_agent;

    @Override
    public String toString() {
        return (civ == null ? "?" : civ) + "(pid=" + pid + ")";
    }
}
