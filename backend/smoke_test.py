"""End-to-end smoke test against the running dev server (stdlib only).

Run the server first (see below), then: venv/Scripts/python.exe smoke_test.py
"""

import json
import os
import urllib.error
import urllib.request

BASE = os.environ.get("QUIZ_BASE", "http://127.0.0.1:8000")


def call(method, path, token=None, **body):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Token {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def ok(label, cond):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    assert cond, label


print("== Claim contestants from the fixed cast ==")
_, james = call("POST", "/api/auth/claim/", name="James")   # admin
_, alice = call("POST", "/api/auth/claim/", name="Stein")
_, bob = call("POST", "/api/auth/claim/", name="Niels")
at, aa, ab = james["token"], alice["token"], bob["token"]
ok("claim returns canonical name", alice["username"] == "Stein")

print("== Unknown names and taken names are rejected ==")
code, _ = call("POST", "/api/auth/claim/", name="Nobody")
ok("unknown contestant rejected (400)", code == 400)
code, _ = call("POST", "/api/auth/claim/", name="stein")   # case-insensitive, already live
ok("live name rejected on 2nd device (409)", code == 409)

print("== Public roster shows who's taken ==")
_, roster = call("GET", "/api/auth/roster/")
stein_entry = next(p for p in roster["players"] if p["name"] == "Stein")
ok("Stein listed as taken", stein_entry["taken"] is True)
ok("8 players in the cast", len(roster["players"]) == 8)

print("== Reset to a clean game ==")
_, st = call("POST", "/api/admin/reset/", token=at)
ok("index reset to -1", st["current_index"] == -1)

print("== State view roles ==")
# Stein polls first so he re-registers in the roster after the reset cleared it
# (every device polls ~1s in the real app).
_, alice_state = call("GET", "/api/game/state/", token=aa)
_, admin_state = call("GET", "/api/game/state/", token=at)
ok("James is admin", admin_state["you"]["is_admin"] is True)
ok("Stein is not admin", alice_state["you"]["is_admin"] is False)
ok("Stein in roster", "Stein" in admin_state["roster"])
ok("James NOT in roster", "James" not in admin_state["roster"])
ok("Stein starts at 1000 coins", alice_state["you"]["budget"] == 1000)

print("== Admin can see the cast and who's present ==")
ok("full cast in players", len(admin_state["players"]) == 8 and "Max" in admin_state["players"])
ok("Stein present", "Stein" in admin_state["present"])
ok("Max absent (never logged in)", "Max" not in admin_state["present"])

print("== Non-admin cannot advance ==")
code, _ = call("POST", "/api/admin/advance/", token=aa, index=0)
ok("alice advance forbidden (403)", code == 403)

print("== Start question 1 ==")
_, st = call("POST", "/api/admin/advance/", token=at, index=0)
ok("index=0", st["current_index"] == 0)
ok("entry open", st["entry_state"] == "open")
ok("question served", st["question"]["text"].startswith("What is the capital"))

print("== Players answer ==")
call("POST", "/api/game/answer/", token=aa, answer="Paris")
call("POST", "/api/game/answer/", token=ab, answer="Berlin")
_, admin_state = call("GET", "/api/game/state/", token=at)
answers = {a["username"]: a["answer"] for a in admin_state["answers"]}
ok("admin sees both answers", answers == {"Stein": "Paris", "Niels": "Berlin"})
_, alice_state = call("GET", "/api/game/state/", token=aa)
ok("Stein does NOT see others' answers", alice_state["answers"] == [])
ok("Stein sees his own answer", alice_state["you"]["my_answer"] == "Paris")

print("== Answer upsert (change answer) ==")
call("POST", "/api/game/answer/", token=ab, answer="Paris")
_, admin_state = call("GET", "/api/game/state/", token=at)
answers = {a["username"]: a["answer"] for a in admin_state["answers"]}
ok("Niels's answer replaced, not duplicated", answers == {"Stein": "Paris", "Niels": "Paris"})

print("== Close entry, then answering is rejected ==")
call("POST", "/api/admin/close/", token=at)
code, _ = call("POST", "/api/game/answer/", token=aa, answer="late")
ok("answer rejected when closed (400)", code == 400)

print("== Mark answers ==")
call("POST", "/api/admin/mark/", token=at, username="Stein", correct=True)
call("POST", "/api/admin/mark/", token=at, username="Niels", correct=True)

print("== Finalize -> scoring ==")
_, st = call("POST", "/api/admin/finalize/", token=at)
ok("entry finalized", st["entry_state"] == "finalized")
ok("Stein scored 1", st["scores"].get("Stein") == 1)
ok("Niels scored 1", st["scores"].get("Niels") == 1)
ok("one snapshot recorded", len(st["score_history"]) == 1)
_, alice_state = call("GET", "/api/game/state/", token=aa)
ok("Stein sees his mark = correct", alice_state["you"]["my_mark"] is True)

print("== Finalize is idempotent (no double scoring) ==")
_, st = call("POST", "/api/admin/finalize/", token=at)
ok("Stein still 1 after re-finalize", st["scores"].get("Stein") == 1)

print("== Betting: market closed until released ==")
code, r = call("POST", "/api/bets/", token=aa, market="quiz_winner", selection="Niels", amount=100)
ok("bet rejected while market locked (400)", code == 400)

print("== Admin opens market ==")
call("POST", "/api/admin/market/", token=at, key="quiz_winner", open=True)
_, alice_state = call("GET", "/api/game/state/", token=aa)
mkt = next(m for m in alice_state["markets"] if m["key"] == "quiz_winner")
ok("market open", mkt["is_open"] is True)
ok("odds present for Niels", "Niels" in mkt["odds"])

print("== Stein bets 100 on Niels ==")
bob_odds = mkt["odds"]["Niels"]
_, st = call("POST", "/api/bets/", token=aa, market="quiz_winner", selection="Niels", amount=100)
ok("Stein budget now 900", st["you"]["budget"] == 900)
ok("Stein has 1 bet", len(st["you"]["my_bets"]) == 1)

print("== Overspend rejected ==")
code, _ = call("POST", "/api/bets/", token=aa, market="quiz_winner", selection="Niels", amount=99999)
ok("overspend rejected (400)", code == 400)

print("== Q2: Niels pulls ahead so he's the winner ==")
call("POST", "/api/admin/advance/", token=at, index=1)
call("POST", "/api/game/answer/", token=ab, answer="Da Vinci")
call("POST", "/api/admin/close/", token=at)
call("POST", "/api/admin/mark/", token=at, username="Niels", correct=True)
_, st = call("POST", "/api/admin/finalize/", token=at)
ok("Niels leads 2-1", st["scores"]["Niels"] == 2 and st["scores"]["Stein"] == 1)

print("== Settle market -> Stein wins his bet on Niels ==")
_, st = call("POST", "/api/admin/settle/", token=at)
ok("winner is Niels", st["settlement"]["winners"] == ["Niels"])
expected_payout = round(100 * bob_odds)
ok("payout = round(100 * odds)", st["settlement"]["paid_out"] == expected_payout)
_, alice_state = call("GET", "/api/game/state/", token=aa)
ok("Stein budget = 900 + payout", alice_state["you"]["budget"] == 900 + expected_payout)
bet = alice_state["you"]["my_bets"][0]
ok("Stein's bet marked won", bet["status"] == "won")

print("== Loser market: Stein (lowest) comes last ==")
call("POST", "/api/admin/market/", token=at, key="quiz_loser", open=True)
_, alice_state = call("GET", "/api/game/state/", token=aa)
lmkt = next(m for m in alice_state["markets"] if m["key"] == "quiz_loser")
ok("loser market open with odds", lmkt["is_open"] and "Stein" in lmkt["odds"])
last_odds = lmkt["odds"]["Stein"]
budget_before = alice_state["you"]["budget"]
_, st = call("POST", "/api/bets/", token=aa, market="quiz_loser", selection="Stein", amount=100)
ok("loser bet placed (budget -100)", st["you"]["budget"] == budget_before - 100)
_, st = call("POST", "/api/admin/settle/", token=at, key="quiz_loser")
ok("last place is Stein", st["settlement"]["winners"] == ["Stein"])
ok("loser payout = round(100 * odds)", st["settlement"]["paid_out"] == round(100 * last_odds))

print("== Challenge parlay: one entry per player, can't back yourself ==")
call("POST", "/api/admin/market/", token=at, key="challenge", open=True)
code, _ = call("POST", "/api/bets/", token=aa, market="challenge", selections=["Stein"], amount=50)
ok("can't back your own challenge (400)", code == 400)
_, st = call("POST", "/api/bets/", token=aa, market="challenge", selections=["Niels"], amount=50)
cbet = next(b for b in st["you"]["my_bets"] if b["market"] == "challenge")
ok("challenge bet at 1.80x (1 pick)", cbet["odds"] == 1.8)
code, _ = call("POST", "/api/bets/", token=aa, market="challenge", selections=["Niels"], amount=10)
ok("only one challenge entry per player (400)", code == 400)
call("POST", "/api/bets/", token=ab, market="challenge", selections=["Stein"], amount=50)

# A third contestant joins the roster to test picking an already-decided player.
_, ivar = call("POST", "/api/auth/claim/", name="Ivar")
ai = ivar["token"]
call("GET", "/api/game/state/", token=ai)  # poll -> joins the roster

print("== Declaring a challenge complete pays the parlay instantly ==")
call("POST", "/api/admin/challenge/", token=at, username="Niels", status="completed")
_, alice_state = call("GET", "/api/game/state/", token=aa)
cbet = next(b for b in alice_state["you"]["my_bets"] if b["market"] == "challenge")
ok("Stein's challenge bet won instantly", cbet["status"] == "won")
ok("challenge payout = round(50 * 1.8)", cbet["payout"] == round(50 * 1.8))

print("== Can't pick a player whose challenge is already decided ==")
code, _ = call("POST", "/api/bets/", token=ai, market="challenge", selections=["Niels"], amount=20)
ok("completed player can't be picked (400)", code == 400)
_, st = call("POST", "/api/bets/", token=ai, market="challenge", selections=["Stein"], amount=20)
ok("Ivar backs Stein", any(b["market"] == "challenge" for b in st["you"]["my_bets"]))

print("== Declaring a challenge failed loses every parlay that picked them ==")
call("POST", "/api/admin/challenge/", token=at, username="Stein", status="failed")
_, bob_state = call("GET", "/api/game/state/", token=ab)
nbet = next(b for b in bob_state["you"]["my_bets"] if b["market"] == "challenge")
ok("Niels's parlay lost (Stein failed)", nbet["status"] == "lost")
_, ivar_state = call("GET", "/api/game/state/", token=ai)
ibet = next(b for b in ivar_state["you"]["my_bets"] if b["market"] == "challenge")
ok("Ivar's parlay lost (Stein failed)", ibet["status"] == "lost")
call("POST", "/api/auth/release/", token=ai)

print("== Release frees the name for another device ==")
call("POST", "/api/auth/release/", token=aa)
_, roster = call("GET", "/api/auth/roster/")
stein_entry = next(p for p in roster["players"] if p["name"] == "Stein")
ok("Stein free again after release", stein_entry["taken"] is False)

print("== Scores visibility toggle ==")
_, st = call("POST", "/api/admin/scores-visible/", token=at, visible=True)
ok("scores visible true", st["scores_visible"] is True)

print("\nALL CHECKS PASSED")
