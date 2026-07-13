from django.core.management.base import BaseCommand

from quiz.models import QUIZ_WINNER_MARKET, Market, Question

# The 35 quiz questions of PUBQUIZ 2026 - PULA. Each entry is a dict.
#   type:         "text" | "multiple_choice" | "text_bonus"
#   text:         the question shown to players
#   options:      the multiple-choice answers (empty for text/text_bonus)
#   bonus_prompt: the label above the second input (text_bonus only)
#
# Questions 9, 30 and 32 are long/visual and are shown on the slide only, so the
# app just says "Bekijk de slide" for those.
QUESTIONS = [
    # Q1
    {"type": "text", "text": "Hoeveel inwoners heeft Pula?"},
    # Q2
    {
        "type": "text",
        "text": (
            "Wie van de mensen hier ging op 24 Mei packet doen op de verjaardag "
            "van een van zijn dierbaren samen met Yunus Ustun en Jay Sugiyama?"
        ),
    },
    # Q3
    {
        "type": "text_bonus",
        "text": "Wie van deze chickies heeft Niels mee getongd?",
        "bonus_prompt": (
            "Bonuspunt: wat is haar naam? (Foute naam: shotje — geen correcte "
            "spelling vereist)"
        ),
    },
    # Q4
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
    # Q5
    {
        "type": "text",
        "text": (
            "Mr. Netanyahu loopt pizzeria bruschetta op IJburg binnen, hij loopt "
            "naar de toonbank en kijkt naar het menu. Mr. Netanyahu kijkt het "
            "personeel aan en zegt: “Gadverdamme verkopen jullie alleen maar "
            "goyslop hier?” en loopt vervolgens de deur uit.\n\n"
            "Wat is de definitie van goyslop?"
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
    # Q9 — long slide question (Mark Spronk dodental)
    {"type": "text", "text": "Bekijk de slide"},
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
        "options": ["DT", "Vale", "Muriel", "I need your pussy ams"],
    },
    # Q23
    {
        "type": "text",
        "text": (
            "Welke manier van klaarkomen, die slechts 0,5% van de Nederlanders "
            "heeft, bezit James?"
        ),
    },
    # Q24
    {
        "type": "text",
        "text": (
            "Van welk nummer en artiest zijn deze lyrics:\n"
            "“Storm / In the sky / Light / Could it be me? / This is my "
            "fantasy”?"
        ),
    },
    # Q25
    {"type": "text", "text": "Welk kruid heeft James onder zijn oksels?"},
    # Q26
    {
        "type": "text",
        "text": (
            "Op welke 2 voedingsstoffen functioneert Finn? "
            "(Correcte taal en spelling vereist)"
        ),
    },
    # Q27
    {
        "type": "text",
        "text": "Met wie is Desi Wagenaar vreemdgegaan op Betty Heijt?",
    },
    # Q28
    {
        "type": "text",
        "text": (
            "Hoe kwam Max aan deze wond op zijn hoofd? "
            "(Het is niet vechten met Yssi)"
        ),
    },
    # Q29
    {
        "type": "text",
        "text": (
            "Hoeveel minuten heeft Matthijs van Nederland - Tunesië gezien in "
            "“De Tent”?"
        ),
    },
    # Q30 — long slide question (het raadsel over een jongen)
    {"type": "text", "text": "Bekijk de slide"},
    # Q31
    {
        "type": "text",
        "text": (
            "Welke natuurlijke grootheid moet optimaal zijn om de goose step te "
            "kunnen uitoefenen?"
        ),
    },
    # Q32 — long slide question (GSS oppervlakteberekening)
    {"type": "text", "text": "Bekijk de slide"},
    # Q33
    {
        "type": "text",
        "text": (
            "Iedereen kent het concept van Galvanized Square Steel (GSS), maar "
            "wat gebeurt er in het proces van staal “galvanizen”?"
        ),
    },
    # Q34
    {"type": "text", "text": "Wat waren de 2 sponsoren van deze pubquiz?"},
    # Q35
    {
        "type": "text",
        "text": (
            "Hoeveel vragen zijn er langsgekomen die al eens in een vorige "
            "pubquiz zijn gesteld of bijna identiek zijn aan een al eerder "
            "gestelde vraag?"
        ),
    },
]


class Command(BaseCommand):
    help = "Seed the 35 quiz questions and the quiz-winner market (idempotent)."

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

        # If the DB still has stale rows from an earlier, longer seed, drop them
        # so the quiz has exactly these questions (ends after Q35, odds use 35).
        Question.objects.filter(order__gt=len(QUESTIONS)).delete()

        Market.objects.get_or_create(key=QUIZ_WINNER_MARKET)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(QUESTIONS)} questions ({created} new) and the quiz-winner market."
            )
        )
