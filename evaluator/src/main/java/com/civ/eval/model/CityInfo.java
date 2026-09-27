package com.civ.eval.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class CityInfo {
    public int pid;
    public long city_id;
    public String city;
    public int pop;
    public String producing;

    @Override
    public String toString() {
        return city + "(pid=" + pid + ")";
    }
}