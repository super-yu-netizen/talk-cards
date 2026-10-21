#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/ 里的 cards.json、series.json、scenes.json 合并成 data/game-data.js，并检查数据有没有问题。

什么时候用：改了任何一个 JSON 文件之后，在项目根目录运行：
    python3 tools/build_data.py
网页只读 data/game-data.js（这样双击 index.html 也能打开），所以改完 JSON 一定要重新生成。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRAW_TYPES = {"random", "sequential", "fixed", "pick", "none"}


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


cards, series, scenes = load("cards.json"), load("series.json"), load("scenes.json")
card_ids = [c["id"] for c in cards]
ids = set(card_ids)
series_keys = {s["key"] for s in series}
errors = []

if len(ids) != len(card_ids):
    errors.append("卡牌 id 有重复")
for c in cards:
    if c["series"] not in series_keys:
        errors.append(f"{c['id']}：系列不存在（{c['series']}）")
    if c["levelType"] not in ("star", "spice") or not 1 <= c["level"] <= 5:
        errors.append(f"{c['id']}：级别不对（{c['levelType']} {c['level']}）")
    if not c["zh"].strip() or not c["en"].strip():
        errors.append(f"{c['id']}：中文或英文是空的")


def check_refs(where, refs):
    for r in refs:
        if r not in ids:
            errors.append(f"{where}：引用了不存在的卡 {r}")


def check_counts(where, pools, expected):
    """按卡牌 id 去重计数；插件使用自己的牌池，不混入主模式。"""
    for deck_mode, label in (("curated", "精选"), ("fullBox", "整盒")):
        actual_ids = set()
        for pool in pools:
            actual_ids.update(pool["cards"])
            if deck_mode == "fullBox":
                actual_ids.update(pool["extraCards"])
        declared = expected.get(deck_mode) if isinstance(expected, dict) else None
        if not isinstance(declared, int) or isinstance(declared, bool) or declared != len(actual_ids):
            errors.append(f"{where}/{label}：counts 声明 {declared} 张，去重后实际 {len(actual_ids)} 张")


for sc in scenes["scenes"]:
    for mode in sc.get("modes", []):
        for stage in mode["stages"]:
            where = f"{sc['name']}/{mode['name']}/{stage['name']}"
            check_refs(where, stage["cards"] + stage["extraCards"])
            if stage["draw"] not in DRAW_TYPES:
                errors.append(f"{where}：draw 类型不对（{stage['draw']}）")
            if stage["draw"] == "fixed" and len(stage["cards"]) != 1:
                errors.append(f"{where}：fixed 阶段应该正好 1 张卡")
        declared_counts = sc.get("counts", {})
        if mode["id"] in declared_counts:
            declared_counts = declared_counts[mode["id"]]
        check_counts(f"{sc['name']}/{mode['name']}", mode["stages"], declared_counts)
    for plugin in sc.get("plugins", []):
        check_refs(f"{sc['name']}/{plugin['name']}", plugin["cards"] + plugin["extraCards"])
        check_counts(f"{sc['name']}/{plugin['name']}", [plugin], sc.get("counts", {}).get("plugin"))
    plan = sc.get("soloPlan")
    if plan:
        check_refs(f"{sc['name']}/soloPlan", plan["openingCards"] + [plan["sundayExtra"]])
        for key in plan["eligibleSeries"] + list(plan["weekdaySeries"].values()):
            if key not in series_keys:
                errors.append(f"{sc['name']}/soloPlan：系列不存在（{key}）")
        eligible_count = len({c["id"] for c in cards if c["series"] in plan["eligibleSeries"]})
        if sc.get("counts", {}).get("eligible") != eligible_count:
            errors.append(f"{sc['name']}/soloPlan：counts 声明 {sc.get('counts', {}).get('eligible')} 张，实际可用 {eligible_count} 张")

if errors:
    print("数据有问题，没有生成 game-data.js：")
    for e in errors:
        print("  -", e)
    sys.exit(1)

bundle = {"cards": cards, "series": series}
bundle.update(scenes)
js = ("// 自动生成的文件，请不要手动修改。\n"
      "// 修改 data/ 里的 JSON 之后，运行 python3 tools/build_data.py 重新生成。\n"
      "window.GAME_DATA = " + json.dumps(bundle, ensure_ascii=False, indent=1) + ";\n")
with open(os.path.join(DATA, "game-data.js"), "w", encoding="utf-8") as f:
    f.write(js)
print(f"已生成 data/game-data.js：{len(cards)} 张卡、{len(series)} 个系列、{len(scenes['scenes'])} 个场景")
