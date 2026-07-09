from django.core.management.base import BaseCommand

from quiz.models import QUIZ_WINNER_MARKET, Market, Question

# The 30 questions, mirroring the frontend's MOCK_QUESTIONS (quizState.ts).
QUESTIONS = [
    ("multiple_choice", "What is the capital of France?", ["London", "Berlin", "Paris", "Madrid"]),
    ("text", "Who painted the Mona Lisa?", []),
    ("multiple_choice", "Which planet is closest to the Sun?", ["Venus", "Mercury", "Earth", "Mars"]),
    ("text", "In what year did World War II end?", []),
    ("multiple_choice", "What is the largest ocean on Earth?", ["Atlantic", "Indian", "Arctic", "Pacific"]),
    ("multiple_choice", "What is the chemical symbol for gold?", ["Go", "Gd", "Au", "Ag"]),
    ("text", "How many continents are there on Earth?", []),
    ("multiple_choice", "Which country hosted the 2016 Summer Olympics?", ["China", "Brazil", "Greece", "Japan"]),
    ("text", "Who wrote the play 'Romeo and Juliet'?", []),
    ("multiple_choice", "What is the tallest mountain in the world?", ["K2", "Kilimanjaro", "Mount Everest", "Denali"]),
    ("multiple_choice", "What is the largest planet in our solar system?", ["Saturn", "Jupiter", "Neptune", "Earth"]),
    ("text", "In which year did the first man walk on the Moon?", []),
    ("multiple_choice", "What is the smallest prime number?", ["0", "1", "2", "3"]),
    ("multiple_choice", "Which language has the most native speakers worldwide?", ["English", "Hindi", "Spanish", "Mandarin Chinese"]),
    ("text", "What is the currency used in Japan?", []),
    ("multiple_choice", "Which element has the atomic number 1?", ["Helium", "Hydrogen", "Oxygen", "Carbon"]),
    ("text", "How many sides does a hexagon have?", []),
    ("multiple_choice", "Which artist is known for the painting 'The Starry Night'?", ["Claude Monet", "Pablo Picasso", "Vincent van Gogh", "Salvador Dalí"]),
    ("multiple_choice", "What is the longest river in the world?", ["Amazon", "Nile", "Yangtze", "Mississippi"]),
    ("text", "Which gas do plants absorb from the atmosphere?", []),
    ("multiple_choice", "How many players are on a standard soccer team on the field?", ["9", "10", "11", "12"]),
    ("multiple_choice", "What is the capital of Australia?", ["Sydney", "Melbourne", "Canberra", "Perth"]),
    ("text", "Who developed the theory of general relativity?", []),
    ("multiple_choice", "Which ocean is the smallest?", ["Indian", "Arctic", "Southern", "Atlantic"]),
    ("multiple_choice", "What is the hardest natural substance on Earth?", ["Gold", "Iron", "Diamond", "Quartz"]),
    ("text", "In which country would you find the Great Pyramid of Giza?", []),
    ("text", "What is the freezing point of water in degrees Celsius?", []),
    ("multiple_choice", "Which planet is known as the Red Planet?", ["Venus", "Mars", "Jupiter", "Mercury"]),
    ("multiple_choice", "How many strings does a standard guitar have?", ["4", "5", "6", "7"]),
    ("text", "Who was the first President of the United States?", []),
]


class Command(BaseCommand):
    help = "Seed the 30 quiz questions and the quiz-winner market (idempotent)."

    def handle(self, *args, **options):
        created = 0
        for i, (qtype, text, options) in enumerate(QUESTIONS, start=1):
            _, was_created = Question.objects.update_or_create(
                order=i,
                defaults={"text": text, "type": qtype, "options": options},
            )
            created += 1 if was_created else 0

        Market.objects.get_or_create(key=QUIZ_WINNER_MARKET)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(QUESTIONS)} questions ({created} new) and the quiz-winner market."
            )
        )
