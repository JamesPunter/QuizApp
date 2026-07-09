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
]

# Pad up to 30 with empty placeholders (order 6-30), to be filled in later.
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
