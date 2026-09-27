package com.civ.eval.analyzer;

import com.civ.eval.model.CityInfo;
import com.civ.eval.model.TurnData;
import com.civ.eval.model.UnitInfo;

import java.util.Map;

public class TurnComparator {

    public static void compare(int turnNum, TurnData current, TurnData next) {
        System.out.println("\n" + "=".repeat(60));
        System.out.println("=== 回合 " + turnNum + " ===");
        System.out.println("=".repeat(60));

        if (current.reflections != null) {
            System.out.println("\n📝 AI 计划：" + current.reflections.planning);
            System.out.println("🔮 AI 预测：" + current.reflections.hypothesis);
        }

        // 对比单位
        Map<Integer, UnitInfo> unitsNow = current.unitsById();
        Map<Integer, UnitInfo> unitsNext = next.unitsById();

        System.out.println("\n⚔️  单位变化：");
        for (Map.Entry<Integer, UnitInfo> e : unitsNow.entrySet()) {
            int uid = e.getKey();
            UnitInfo uNow = e.getValue();
            UnitInfo uNext = unitsNext.get(uid);

            if (uNext != null) {
                boolean posChanged = uNow.x != uNext.x || uNow.y != uNext.y;
                boolean dmgChanged = uNow.damage != uNext.damage;

                StringBuilder status = new StringBuilder();
                if (posChanged) {
                    status.append(String.format("位置 (%d,%d) → (%d,%d)",
                            uNow.x, uNow.y, uNext.x, uNext.y));
                }
                if (dmgChanged) {
                    if (status.length() > 0) status.append(", ");
                    status.append("损伤 ").append(uNow.damage)
                            .append(" → ").append(uNext.damage);
                }

                if (status.length() > 0) {
                    System.out.printf("  ✅ %s (id=%d): %s%n", uNow.type, uid, status);
                } else {
                    System.out.printf("  ⚪ %s (id=%d): 无变化%n", uNow.type, uid);
                }
            } else {
                System.out.printf("  ❌ %s (id=%d): 消失了%n", uNow.type, uid);
            }
        }

        // 对比城市（pid=0 是我方）
        CityInfo cityNow = current.findCityByPid(0);
        CityInfo cityNext = next.findCityByPid(0);

        System.out.println("\n🏙️  城市生产：");
        if (cityNow != null && cityNext != null) {
            if (!cityNow.producing.equals(cityNext.producing)) {
                System.out.printf("  ✅ %s → %s（完工了！）%n",
                        cityNow.producing, cityNext.producing);
            } else {
                System.out.printf("  ⚪ 仍在生产 %s（未完工）%n", cityNow.producing);
            }
        }
    }

    // ===== 新增：返回单位变化列表（供 API 使用） =====
    public static java.util.List<java.util.Map<String, Object>> getUnitChanges(
            TurnData current, TurnData next) {
        java.util.List<java.util.Map<String, Object>> changes = new java.util.ArrayList<>();
        java.util.Map<Integer, UnitInfo> unitsNow = current.unitsById();
        java.util.Map<Integer, UnitInfo> unitsNext =
                next == null ? java.util.Map.of() : next.unitsById();

        for (java.util.Map.Entry<Integer, UnitInfo> e : unitsNow.entrySet()) {
            int uid = e.getKey();
            UnitInfo uNow = e.getValue();
            UnitInfo uNext = unitsNext.get(uid);

            java.util.Map<String, Object> item = new java.util.HashMap<>();
            item.put("id", uid);
            item.put("type", uNow.type);

            if (uNext == null) {
                item.put("status", "disappeared");
            } else {
                boolean posChanged = uNow.x != uNext.x || uNow.y != uNext.y;
                boolean dmgChanged = uNow.damage != uNext.damage;
                item.put("status", (posChanged || dmgChanged) ? "changed" : "unchanged");
                item.put("fromX", uNow.x);
                item.put("fromY", uNow.y);
                item.put("toX", uNext.x);
                item.put("toY", uNext.y);
                item.put("fromDamage", uNow.damage);
                item.put("toDamage", uNext.damage);
            }
            changes.add(item);
        }
        return changes;
    }

    // ===== 新增：返回城市变化（供 API 使用） =====
    public static java.util.Map<String, Object> getCityChange(
            TurnData current, TurnData next) {
        CityInfo cNow = current.findCityByPid(0);
        if (cNow == null) return null;

        java.util.Map<String, Object> result = new java.util.HashMap<>();
        result.put("city", cNow.city);
        result.put("from", cNow.producing);

        if (next != null) {
            CityInfo cNext = next.findCityByPid(0);
            if (cNext != null) {
                result.put("to", cNext.producing);
                result.put("completed", !cNow.producing.equals(cNext.producing));
            }
        }
        return result;
    }
}


