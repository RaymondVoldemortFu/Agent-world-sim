"""Exact JSON state deltas. Paths are arrays; no JSON-pointer escaping ambiguity."""

from copy import deepcopy


def order_diff(before, after, path=()):
    """Preserve JSON property order used by the existing JavaScript replay hash."""
    if before is after:
        return []
    ops = []
    if isinstance(before, dict) and isinstance(after, dict):
        if list(before) != list(after):
            ops.append(["order", list(path), list(after)])
        for key in after:
            ops.extend(order_diff(before.get(key), after[key], (*path, key)))
    elif isinstance(before, list) and isinstance(after, list):
        for i, (a, b) in enumerate(zip(before, after)):
            ops.extend(order_diff(a, b, (*path, i)))
    return ops


def diff(before, after, path=()):
    if before is after:
        return []
    if before == after:
        return order_diff(before, after, path)
    if isinstance(before, dict) and isinstance(after, dict):
        ops = []
        for key in before.keys() - after.keys():
            ops.append(["del", list(path) + ([key]), None])
        for key, value in after.items():
            if key not in before:
                ops.append(["set", [*path, key], value])
            else:
                ops.extend(diff(before[key], value, (*path, key)))
        predicted = [k for k in before if k in after] + [
            k for k in after if k not in before
        ]
        if predicted != list(after):
            ops.append(["order", list(path), list(after)])
        return ops
    if isinstance(before, list) and isinstance(after, list):
        # Rolling memories/inboxes: encode drop+append, not 200 shifted records.
        if (
            before
            and after
            and all(isinstance(x, dict) and "id" in x for x in before + after)
        ):
            ids = [x["id"] for x in before]
            if after[0]["id"] in ids:
                drop = ids.index(after[0]["id"])
                overlap = len(before) - drop
                if drop and after[:overlap] == before[drop:]:
                    return [
                        ["queue", list(path), [drop, after[overlap:]]],
                        *order_diff(before[drop:], after[:overlap], path),
                    ]
        common = min(len(before), len(after))
        ops = []
        for i in range(common):
            ops.extend(diff(before[i], after[i], (*path, i)))
        if len(before) != len(after):
            ops.append(["tail", list(path), [common, after[common:]]])
        return ops
    return [["set", list(path), after]]


def apply(world, ops):
    for kind, path, value in ops:
        parent = world
        for key in path[:-1]:
            parent = parent[key]
        if kind == "set":
            parent[path[-1]] = deepcopy(value)
        elif kind == "del":
            del parent[path[-1]]
        else:
            target = parent[path[-1]] if path else world
            if kind == "order":
                if set(target) != set(value):
                    raise ValueError("Invalid order keys")
                ordered = {key: target[key] for key in value}
                target.clear()
                target.update(ordered)
                continue
            n, append = value
            if kind == "queue":
                del target[:n]
                target.extend(deepcopy(append))
            elif kind == "tail":
                target[n:] = deepcopy(append)
            else:
                raise ValueError("Unknown delta operation")
    return world


def event_delta(world, event):
    """Apply an original event patch, emitting changes only for its touched state."""
    patch = event["patch"]
    ops = []

    def replace(key, value):
        if key not in world:
            ops.append(["set", [key], value])
        else:
            ops.extend(diff(world[key], value, (key,)))
        world[key] = value

    for key, value in patch.get("meta", {}).items():
        replace(key, value)
    indexes = {a["id"]: i for i, a in enumerate(world["agents"])}
    for a in patch.get("agents", []):
        i = indexes.get(a["id"])
        if i is None:
            i = len(world["agents"])
            indexes[a["id"]] = i
            ops.append(["tail", ["agents"], [i, [a]]])
            world["agents"].append(a)
        else:
            ops.extend(diff(world["agents"][i], a, ("agents", i)))
            world["agents"][i] = a
    for change in patch.get("agentChanges", []):
        state = change["state"]
        i = indexes[state["id"]]
        old = world["agents"][i]
        new = {**old, **state}
        for key in ("pregnancy", "death"):
            if key not in state:
                new.pop(key, None)
        for key in ("memories", "inbox", "claims"):
            delta = change[key]
            new[key] = old[key][delta["drop"] :] + delta["append"]
        ops.extend(diff(old, new, ("agents", i)))
        world["agents"][i] = new
    size = world["config"]["size"]
    for tile in patch.get("tiles", []):
        region = tile.get("eco", {}).get("region", 0)
        i = region * size * size + tile["y"] * size + tile["x"]
        ops.extend(diff(world["tiles"][i], tile, ("tiles", i)))
        world["tiles"][i] = tile
    if "proposals" in patch:
        replace("proposals", patch["proposals"])
    if "metrics" in patch:
        replace("metrics", patch["metrics"])
    if world["seq"] != event["seq"]:
        raise ValueError("Event/meta sequence mismatch")
    return ops
