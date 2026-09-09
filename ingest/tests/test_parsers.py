"""Parser tests.

Run from the ingest directory:  python -m tests.test_parsers

Deliberately plain asserts and no pytest dependency - this has to be runnable
on the server over SSH after a template edit, not just in a dev environment.
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import parsers  # noqa: E402

TEMPLATE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates"
)

RECEIVED = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)

failures = []
checks = 0


def check(label, actual, expected):
    global checks
    checks += 1
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


def parse(text, sender=None):
    return parsers.parse_message(text, sender=sender, received_at=RECEIVED)


def test_amount_parsing():
    check("comma amount", parsers.parse_amount("1,234.50"), 1234.5)
    check("plain amount", parsers.parse_amount("500"), 500.0)
    check("lakh grouping", parsers.parse_amount("1,00,000"), 100000.0)
    check("zero rejected", parsers.parse_amount("0"), None)
    check("junk rejected", parsers.parse_amount("abc"), None)
    check("none rejected", parsers.parse_amount(None), None)


def test_currency_aliases():
    check("Rs.", parsers.normalise_currency("Rs."), "PKR")
    check("RS", parsers.normalise_currency("RS"), "PKR")
    check("PKR", parsers.normalise_currency("PKR"), "PKR")
    check("dollar", parsers.normalise_currency("$"), "USD")


def test_direction_by_position():
    # "debit card" appears after "credited" - the first cue is the real one.
    check(
        "credit wins on position",
        parsers.detect_direction(
            "Your account has been credited with PKR 100 on your debit card"
        ),
        "credit",
    )
    check(
        "debit detected",
        parsers.detect_direction("PKR 500 has been debited from your account"),
        "debit",
    )
    check("no cue", parsers.detect_direction("Your statement is ready"), None)


def test_balance_is_not_the_amount():
    # The balance is quoted second here, and also first in the second case.
    amount, currency = parsers.extract_amount_and_currency(
        "Debited PKR 250.00 at SHELL. Avl Bal PKR 45,000.00"
    )
    check("amount not balance (trailing)", amount, 250.0)
    check("currency", currency, "PKR")

    amount, _ = parsers.extract_amount_and_currency(
        "Avl Bal PKR 45,000.00. Txn amount PKR 250.00"
    )
    check("amount not balance (leading)", amount, 250.0)


def test_last4_extraction():
    check("asterisks", parsers.extract_last4("Card ****1234 used"), "1234")
    check("ending in", parsers.extract_last4("card ending in 5678"), "5678")
    check("a/c form", parsers.extract_last4("A/C no 9012 debited"), "9012")
    check("absent", parsers.extract_last4("You spent PKR 100"), None)


def test_noise_is_rejected():
    for text in [
        "Your OTP is 123456. Do not share it with anyone.",
        "123456 is your code for login.",
        "Congratulations! You could win a prize worth PKR 100,000",
    ]:
        result = parse(text)
        check(f"noise: {text[:24]}", result["isNoise"], True)
        check(f"noise confidence: {text[:24]}", result["confidence"], 0.0)


def test_jazzcash_received():
    result = parse(
        "You have received Rs. 5,000.00 in your JazzCash account from "
        "AHMED KHAN. TID: 987654321. Your balance is Rs. 12,300.00",
        sender="JazzCash",
    )
    check("jazzcash template", result["templateId"], "jazzcash-received")
    check("jazzcash amount", result["parsed"]["amount"], 5000.0)
    check("jazzcash direction", result["parsed"]["direction"], "credit")
    check("jazzcash merchant", result["parsed"]["merchant"], "AHMED KHAN")
    check("jazzcash bank", result["parsed"]["bank"], "JazzCash")


def test_sadapay_card():
    result = parse(
        "You spent PKR 1,250.00 at CAREEM with your SadaPay card. "
        "Balance: PKR 3,000.00",
        sender="SadaPay",
    )
    check("sadapay template", result["templateId"], "sadapay-card")
    check("sadapay amount", result["parsed"]["amount"], 1250.0)
    check("sadapay merchant", result["parsed"]["merchant"], "CAREEM")
    check("sadapay direction", result["parsed"]["direction"], "debit")


def test_generic_card_purchase():
    result = parse(
        "Your Debit Card ending 4321 was used for PKR 3,499.00 at "
        "METRO CASH CARRY on 08-Sep-26. Avl Bal PKR 22,100.00",
        sender="UBL",
    )
    check("card amount", result["parsed"]["amount"], 3499.0)
    check("card last4", result["parsed"]["last4"], "4321")
    check("card merchant", result["parsed"]["merchant"], "METRO CASH CARRY")
    check("card direction", result["parsed"]["direction"], "debit")


def test_template_match_still_fills_date_and_bank():
    # A template that names neither (generic-card-purchase carries no `date`
    # group and no bank) must still end up with the date the message states
    # and the sender as the bank label. Both were being dropped: a template
    # match used to skip the generic fill-in for these two fields.
    result = parse(
        "Your Debit Card ending 4321 was used for PKR 3,499.00 at "
        "METRO CASH CARRY on 08-Sep-26. Avl Bal PKR 22,100.00",
        sender="Askari",
    )
    check("template matched", result["templateId"], "generic-card-purchase")
    check("date from message", result["parsed"]["occurredAt"][:10], "2026-09-08")
    check("bank falls back to sender", result["parsed"]["bank"], "Askari")


def test_template_date_group_wins():
    # Where a template does capture the date, that stays authoritative.
    result = parse(
        "You have received Rs. 500.00 in your JazzCash account from "
        "ALI. TID: 1. Your balance is Rs. 900.00",
        sender="JazzCash",
    )
    check("named bank kept", result["parsed"]["bank"], "JazzCash")


# --- Askari, from real messages -------------------------------------------

def test_askari_raast_credit():
    result = parse(
        "PKR. 100.00 received from PK*SADA5107 in AKBL PKASCM*5664 "
        "HUZAIFA SADEEM via Raast on 09 09 26 at 22 39 Ref# 152239292343",
        sender="Askari Bank",
    )
    check("raast template", result["templateId"], "askari-transfer-credit")
    check("raast amount", result["parsed"]["amount"], 100.0)
    check("raast direction", result["parsed"]["direction"], "credit")
    # The counterparty, not the recipient: the message names both.
    check("raast merchant", result["parsed"]["merchant"], "PK*SADA5107")
    # Own account, not the sender's.
    check("raast last4", result["parsed"]["last4"], "5664")
    check("raast date", result["parsed"]["occurredAt"][:10], "2026-09-09")


def test_askari_pos_debit():
    result = parse(
        "Dear Customer, you have performed a POS transaction of PKR. 4,000.00 "
        "from Account: 017516***664 on LUMS, at 16:29:12 Dated: 09-SEP-26",
        sender="Askari Bank",
    )
    check("pos template", result["templateId"], "askari-pos-debit")
    check("pos amount", result["parsed"]["amount"], 4000.0)
    check("pos direction", result["parsed"]["direction"], "debit")
    check("pos merchant", result["parsed"]["merchant"], "LUMS")
    check("pos date", result["parsed"]["occurredAt"][:10], "2026-09-09")


def test_askari_ibft_credit_named_person():
    # The hard one: the sender's name runs straight into their account
    # details, and the recipient's name follows. Only the first belongs.
    result = parse(
        "PKR 1,155.00 received from NAVEERA SEERAT AKBL A C *0462 in "
        "HUZAIFA SADEEM AKBL AC# 175*5664  on 09 09 26 at 00 04 "
        "Ref# 252639172568",
        sender="Askari Bank",
    )
    check("ibft amount", result["parsed"]["amount"], 1155.0)
    check("ibft merchant is the sender", result["parsed"]["merchant"], "NAVEERA SEERAT")
    check("ibft last4 is own account", result["parsed"]["last4"], "5664")
    check("ibft direction", result["parsed"]["direction"], "credit")


def test_askari_ibft_credit_company():
    result = parse(
        "IBFT of PKR. 16,129.00 received from PREMIER CHOICE A C *8940 in "
        "HUZAIFA SADEEM AKBL A C *5664 on 01 09 26  11 10 Ref# 000000437278",
        sender="Askari Bank",
    )
    check("ibft company amount", result["parsed"]["amount"], 16129.0)
    check("ibft company merchant", result["parsed"]["merchant"], "PREMIER CHOICE")
    check("ibft company last4", result["parsed"]["last4"], "5664")
    check("ibft company date", result["parsed"]["occurredAt"][:10], "2026-09-01")


def test_askari_dividend_credit():
    result = parse(
        "2ND INTERIM DIV PAYMENT AMOUNTING TO PKR 2009 FOR FY2026 (D-157) "
        "AGAINST SHARES OF FFC HAS BEEN CREDITED IN YOUR A/C PK37*****5664 "
        "VIA AKBL",
        sender="Askari Bank",
    )
    check("dividend template", result["templateId"], "askari-dividend-credit")
    # The regression this pins: an uncommaed four-digit amount used to parse
    # as its first three digits, so PKR 2009 became 200.
    check("dividend amount", result["parsed"]["amount"], 2009.0)
    check("dividend merchant", result["parsed"]["merchant"], "FFC")
    check("dividend direction", result["parsed"]["direction"], "credit")


def test_uncommaed_amounts_are_not_truncated():
    for text, expected in [
        ("PKR 2009 debited", 2009.0),
        ("PKR 12345 debited", 12345.0),
        ("Rs. 400 debited", 400.0),
        ("PKR 1,234.50 debited", 1234.5),
        ("PKR 1,00,000 debited", 100000.0),
    ]:
        amount, _ = parsers.extract_amount_and_currency(text)
        check(f"amount in {text!r}", amount, expected)


def test_currency_with_trailing_period():
    amount, currency = parsers.extract_amount_and_currency("PKR. 100.00 received")
    check("PKR. amount", amount, 100.0)
    check("PKR. currency", currency, "PKR")


# --- Wallet push notifications --------------------------------------------

def test_wallet_sent_to():
    result = parse(
        "Off it goes \U0001F4B8 Rs. 100 sent to Huzaifa Sadeem. "
        "Your wallet's seen better days.",
        sender="SadaPay",
    )
    check("sent-to template", result["templateId"], "wallet-sent-to")
    check("sent-to amount", result["parsed"]["amount"], 100.0)
    check("sent-to direction", result["parsed"]["direction"], "debit")
    check("sent-to merchant", result["parsed"]["merchant"], "Huzaifa Sadeem")


def test_wallet_received_from():
    result = parse(
        "Cha-Ching! \U0001F911 Rs. 100 received from Huzaifa Sadeem. "
        "Just the kind of notification we like.",
        sender="SadaPay",
    )
    check("received-from template", result["templateId"], "wallet-received-from")
    check("received-from amount", result["parsed"]["amount"], 100.0)
    check("received-from direction", result["parsed"]["direction"], "credit")
    check("received-from merchant", result["parsed"]["merchant"], "Huzaifa Sadeem")


def test_wallet_sent_you_is_income():
    # The regression this pins: the message never says "from", and its only
    # directional word is "sent", so it used to parse as money going out - or
    # rather with no direction at all, and no merchant.
    result = parse(
        "Money Received HUZAIFA SADEEM sent you PKR 100 \U0001F389",
        sender="NayaPay",
    )
    check("titled template", result["templateId"], "wallet-received-titled")
    check("sent-you amount", result["parsed"]["amount"], 100.0)
    check("sent-you is credit", result["parsed"]["direction"], "credit")
    # Not "Money Received HUZAIFA SADEEM" - the title must not be swallowed.
    check("sent-you merchant", result["parsed"]["merchant"], "HUZAIFA SADEEM")


def test_wallet_sent_you_body_only():
    # Same wording with the notification title missing.
    result = parse("HUZAIFA SADEEM sent you PKR 250", sender="NayaPay")
    check("body-only template", result["templateId"], "wallet-received-sent-you")
    check("body-only merchant", result["parsed"]["merchant"], "HUZAIFA SADEEM")
    check("body-only direction", result["parsed"]["direction"], "credit")
    check("body-only amount", result["parsed"]["amount"], 250.0)


def test_sent_to_is_still_debit():
    # "sent you" is a credit cue; "sent to" must stay a debit one.
    check("sent to", parsers.detect_direction("Rs 100 sent to Ali"), "debit")
    check("sent you", parsers.detect_direction("Ali sent you Rs 100"), "credit")


def test_unknown_sender_generic_path():
    result = parse(
        "Your account has been debited with PKR 899.00 at FOODPANDA on "
        "09/09/2026. Avl Bal PKR 5,000.00",
        sender="SOMEBANK",
    )
    check("generic template", result["templateId"], None)
    check("generic amount", result["parsed"]["amount"], 899.0)
    check("generic direction", result["parsed"]["direction"], "debit")
    check("generic merchant", result["parsed"]["merchant"], "FOODPANDA")
    # Confidence starts at 0.5 for the generic path, minus 0.05 for no card.
    check("generic confidence", result["confidence"], 0.45)


def test_bank_sender_is_labelled():
    result = parse(
        "Dear Customer, your account has been debited with PKR 750.00 "
        "at K ELECTRIC on 09/09/2026.",
        sender="Meezan",
    )
    check("meezan template", result["templateId"], "pk-bank-meezan")
    check("meezan bank label", result["parsed"]["bank"], "Meezan Bank")
    check("meezan amount", result["parsed"]["amount"], 750.0)
    check("meezan direction", result["parsed"]["direction"], "debit")


def test_sender_scoping():
    # A JazzCash-worded message from a different sender must not claim the
    # JazzCash template.
    result = parse(
        "You have received Rs. 100.00 from SOMEONE.", sender="RandomSender"
    )
    check("sender scoping", result["templateId"], None)


def test_future_date_is_rejected():
    # A misread date must not land the transaction in next year.
    result = parse(
        "Your account was debited with PKR 100.00 on 31/12/2099.",
        sender="SOMEBANK",
    )
    check("future date falls back", result["parsed"]["occurredAt"],
          RECEIVED.isoformat())


def test_stated_date_is_used():
    result = parse(
        "Your account was debited with PKR 100.00 on 08/09/2026.",
        sender="SOMEBANK",
    )
    check("stated date used", result["parsed"]["occurredAt"][:10], "2026-09-08")


def test_empty_and_amountless():
    check("empty text", parse("")["isNoise"], True)
    check("no amount", parse("Your statement is ready to view.")["isNoise"], True)


def main():
    parsers.load_templates(TEMPLATE_DIR)
    loaded = len(parsers.get_templates())
    if loaded == 0:
        print("FAIL: no templates loaded from", TEMPLATE_DIR)
        return 1
    print(f"Loaded {loaded} templates from {TEMPLATE_DIR}")

    for name, function in sorted(globals().items()):
        if name.startswith("test_") and callable(function):
            function()

    if failures:
        print(f"\n{len(failures)} of {checks} checks FAILED:\n")
        for failure in failures:
            print("  -", failure)
        return 1

    print(f"All {checks} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
