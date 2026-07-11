from django.core.management.base import BaseCommand

from quiz.models import QUIZ_WINNER_MARKET, Market, Question

# The 30 quiz questions. Each entry is a dict; only questions 1-5 are filled in
# for now — 6-30 are placeholders to be written later (the quiz always has 30).
#   type:         "text" | "multiple_choice" | "text_bonus"
#   text:         the question shown to players
#   options:      the multiple-choice answers (empty for text/text_bonus)
#   bonus_prompt: the label above the second input (text_bonus only)
QUESTIONS = [
    {"type": "text", "text": "Hoeveel inwoners heeft Pula?"},
    {
        "type": "text",
        "text": (
            "Wie van de mensen hier ging op 24 Mei packet doen op de verjaardag "
            "van een van zijn dierbaren samen met Yunus Ustun en Jay Sugiyama?"
        ),
    },
    {
        "type": "text_bonus",
        "text": "Met wie van deze chickies heeft Niels getongd?",
        "bonus_prompt": (
            "Bonuspunt: wat is haar naam? (Foute naam: shotje — geen correcte "
            "spelling vereist)"
        ),
    },
    {
        "type": "multiple_choice",
        "text": "Wie zijn volgens Tris zijn echte matties?",
        "options": [
            "Wij Poemols1",
            "Geinburgia (Charbon, Kleine john & Ilias vietto)",
            "Blackas van vechtstede (havo mannen)",
            "Crink Normie & Lucvantee",
        ],
    },
    {
        "type": "text",
        "text": (
            "Mr. Netanyahu loopt pizzeria bruschetta op IJburg binnen, hij loopt "
            "naar de toonbank en kijkt naar het menu. Mr. Netanyahu kijkt het "
            "personeel aan en zegt: “Gadverdamme verkopen jullie alleen maar "
            "goyslop hier?” en loopt vervolgens de deur uit.\n\n"
            "Wat betekent goyslop?"
        ),
    },
    # Q6
    {
        "type": "text",
        "text": (
            "Waar zijn deze termen van: Destined Rivals, Journey Together, "
            "Surging Sparks?"
        ),
    },
    # Q7
    {"type": "text", "text": "Wat staat er op Stein zijn rider?"},
    # Q8
    {"type": "text", "text": "Hoe lang is de langste voorhuid ter wereld?"},
    # Q9
    {"type": "text", "text": "Lees de vraag op de slide"},
    # Q10
    {
        "type": "text",
        "text": (
            "Wat is unaniem besloten de beste pubquizvraag ten aller tijden?"
        ),
    },
    # Q11
    {"type": "text", "text": "Wie was de eerste president van Amerika?"},
    # Q12
    {
        "type": "text",
        "text": (
            "Hoe heette het restaurant waar Niels na zijn 2e shift op staande "
            "voet is ontslagen?"
        ),
    },
    # Q13
    {"type": "text", "text": "Wie was de biggest cuck van het Hyperion?"},
    # Q14
    {"type": "text", "text": "Wanneer vallen free thinkers door de mand?"},
    # Q15
    {
        "type": "multiple_choice",
        "text": "Bij wat horen deze 3 termen: Vanta, Musou & Ivory?",
        "options": [
            "Koe soorten",
            "Kleur soorten",
            "Papier soorten",
            "Deeltjesversnellers",
        ],
    },
    # Q16
    {
        "type": "text",
        "text": (
            "Welke 2 waren Stein zijn meest succesvolle pump-and-dump schemes?"
        ),
    },
    # Q17
    {"type": "text", "text": "Door welke meid is Niels recentelijk afgewezen?"},
    # Q18
    {"type": "text", "text": "Wie heeft het vaakst gebarfd bij de Huyskamer?"},
    # Q19
    {
        "type": "text",
        "text": (
            "In welk Europees land ligt een 40 kilometer lang lint van 80 "
            "vulkanen dat sinds 2018 op de werelderfgoedlijst staat?"
        ),
    },
    # Q20
    {"type": "text", "text": "Hoe heette de jongen waarmee Isa ging voor Sep?"},
    # Q21
    {
        "type": "multiple_choice",
        "text": "Welk aapje is Ivar?",
        "options": ["A", "B", "C", "D"],
    },
    # Q22
    {
        "type": "multiple_choice",
        "text": "Wie mist Matthijs het meest?",
        "options": ["DT", "Vale", "Muriel", "I need you pussy ams"],
    },
]

# Pad up to 30 with empty placeholders (order 23-30), to be filled in later.
for _n in range(len(QUESTIONS) + 1, 31):
    QUESTIONS.append({"type": "text", "text": f"Vraag {_n} (volgt nog)"})


class Command(BaseCommand):
    help = "Seed the 30 quiz questions and the quiz-winner market (idempotent)."

    def handle(self, *args, **options):
        created = 0
        for i, q in enumerate(QUESTIONS, start=1):
            _, was_created = Question.objects.update_or_create(
                order=i,
                defaults={
                    "text": q["text"],
                    "type": q["type"],
                    "options": q.get("options", []),
                    "bonus_prompt": q.get("bonus_prompt", ""),
                },
            )
            created += 1 if was_created else 0

        Market.objects.get_or_create(key=QUIZ_WINNER_MARKET)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(QUESTIONS)} questions ({created} new) and the quiz-winner market."
            )
        )
