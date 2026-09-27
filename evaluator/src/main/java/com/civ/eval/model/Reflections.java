package com.civ.eval.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Reflections {
    public String tactical;
    public String strategic;
    public String tooling;
    public String planning;
    public String hypothesis;
}
