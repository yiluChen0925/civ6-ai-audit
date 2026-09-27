package com.civ.eval.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class UnitInfo {
    public int id;
    public String type;
    public int x;
    public int y;
    public int damage;
    public int moves;

    @Override
    public String toString() {
        return type + "(id=" + id + ")";
    }
}