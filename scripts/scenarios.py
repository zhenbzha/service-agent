"""Customer turns used by the smoke tests.

These are test inputs only. Expected answers are not asserted here and must never be copied
into agent instructions; a person reviews the printed answers against data.json and the
handbook in knowledge/.
"""

SCENARIOS: dict[str, list[str]] = {
    "high-bill": [
        "Hi, my latest electricity bill is much higher than usual. Can you check why?",
        "My customer number is 100245 and my postcode is 00150.",
        "Yes, please correct it.",
        "No, that's all. Thanks, bye!",
    ],
    "paid-twice": [
        "Hello, I think I paid my October bill twice.",
        "Customer number 100318, postcode 02100.",
        "Can I get that money back to my bank account?",
        "Yes, please.",
    ],
    "price-increase": [
        "Why is my October invoice so expensive? Is it a mistake?",
        "It's customer number 100472, postcode 33100.",
    ],
    "payment-extension": [
        "Can I get more time to pay my current bill?",
        "My customer number is 100533 and the postcode is 90100.",
        "What's the latest date I could pay it then?",
        "Yes, please move it to that date.",
    ],
    "disconnection-notice": [
        "I got a disconnection notice and I'm worried.",
        "Customer number 100533, postcode 90100.",
        "Yes, please.",
    ],
    "wrong-postcode": [
        "I want to check my latest bill.",
        "Customer number 100245, postcode 00100.",
    ],
    "out-of-scope": [
        "Can you help me choose a charger for my electric car?",
    ],
}
