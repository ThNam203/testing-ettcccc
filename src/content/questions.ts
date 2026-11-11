import type { QuestionSource } from '../engine/types';

/**
 * Question bank. Edit freely — it is validated at startup (src/engine/questions.ts#validateBank).
 * `answer` = index of the correct choice as written here; choices are shuffled per race.
 * Keep choices short: viewers answer with A/B/C/D or by typing the choice.
 */
export const QUESTION_BANK: readonly QuestionSource[] = [
  // ---------- A2 ----------
  { id: 'a2-01', level: 'A2', category: 'Vocabulary', prompt: "Opposite of 'cheap'?", choices: ['expensive', 'small', 'easy', 'quiet'], answer: 0, explanation: "Cheap = low price. Expensive = high price." },
  { id: 'a2-02', level: 'A2', category: 'Grammar', prompt: 'She ___ to school every day.', choices: ['goes', 'go', 'going', 'gone'], answer: 0, explanation: 'Present simple with he/she/it adds -s/-es: she goes.' },
  { id: 'a2-03', level: 'A2', category: 'Grammar', prompt: 'I ___ TV when you called me.', choices: ['was watching', 'am watching', 'watch', 'have watched'], answer: 0, explanation: 'Past continuous (was/were + -ing) = an action in progress when something else happened.' },
  { id: 'a2-04', level: 'A2', category: 'Prepositions', prompt: 'The meeting is ___ Monday.', choices: ['in', 'on', 'at', 'by'], answer: 1, explanation: "Use 'on' with days and dates: on Monday, on 5 May." },
  { id: 'a2-05', level: 'A2', category: 'Prepositions', prompt: 'We arrived ___ 7 o\'clock.', choices: ['in', 'on', 'at', 'for'], answer: 2, explanation: "Use 'at' with clock times: at 7 o'clock, at noon." },
  { id: 'a2-06', level: 'A2', category: 'Plurals', prompt: "Plural of 'child'?", choices: ['childs', 'childes', 'children', 'childrens'], answer: 2, explanation: "'Child' is irregular: one child, two children." },
  { id: 'a2-07', level: 'A2', category: 'Vocabulary', prompt: 'A person who flies a plane is a ___.', choices: ['pilot', 'driver', 'sailor', 'chef'], answer: 0, explanation: 'Pilot = flies a plane. Sailor = works on a ship. Chef = cooks.' },
  { id: 'a2-08', level: 'A2', category: 'Comparatives', prompt: 'This box is ___ than that one.', choices: ['heavyer', 'heavier', 'more heavy', 'heaviest'], answer: 1, explanation: 'Consonant + y → -ier: heavy → heavier. Heaviest is the superlative.' },
  { id: 'a2-09', level: 'A2', category: 'Grammar', prompt: 'There ___ some milk in the fridge.', choices: ['is', 'are', 'be', 'am'], answer: 0, explanation: "Milk is uncountable, so use 'there is'." },
  { id: 'a2-10', level: 'A2', category: 'Quantifiers', prompt: 'How ___ apples do you want?', choices: ['much', 'many', 'lot', 'more of'], answer: 1, explanation: "'How many' for countable nouns (apples); 'how much' for uncountable (water)." },
  { id: 'a2-11', level: 'A2', category: 'Past simple', prompt: 'Yesterday I ___ a great movie.', choices: ['see', 'seen', 'saw', 'seeing'], answer: 2, explanation: 'See → saw (past simple) → seen (past participle).' },
  { id: 'a2-12', level: 'A2', category: 'Spelling', prompt: 'Which spelling is correct?', choices: ['recieve', 'receive', 'receeve', 'riceive'], answer: 1, explanation: "Rule of thumb: 'i before e, except after c' → receive." },
  { id: 'a2-13', level: 'A2', category: 'Vocabulary', prompt: 'Where do you borrow books?', choices: ['library', 'bakery', 'pharmacy', 'garage'], answer: 0, explanation: 'Library = borrow books. Bakery = bread. Pharmacy = medicine.' },
  { id: 'a2-14', level: 'A2', category: 'Collocations', prompt: "Let's ___ lunch at a restaurant.", choices: ['do', 'have', 'play', 'take'], answer: 1, explanation: "We 'have' meals: have breakfast, have lunch, have dinner." },
  { id: 'a2-15', level: 'A2', category: 'Prepositions', prompt: 'My birthday is ___ July.', choices: ['on', 'at', 'in', 'to'], answer: 2, explanation: "Use 'in' with months, years and seasons: in July, in 2026." },
  { id: 'a2-16', level: 'A2', category: 'Vocabulary', prompt: "Which word means 'very big'?", choices: ['huge', 'tiny', 'thin', 'short'], answer: 0, explanation: 'Huge = very big. Tiny = very small.' },
  { id: 'a2-17', level: 'A2', category: 'Modal verbs', prompt: 'She can ___ three languages.', choices: ['speaks', 'speak', 'speaking', 'to speak'], answer: 1, explanation: 'After can/could/must/should use the base verb: can speak.' },
  { id: 'a2-18', level: 'A2', category: 'Questions', prompt: '___ you like coffee?', choices: ['Does', 'Do', 'Are', 'Is'], answer: 1, explanation: "Present simple questions: Do + I/you/we/they, Does + he/she/it." },
  { id: 'a2-19', level: 'A2', category: 'Time', prompt: "6:30 is '___'.", choices: ['half past six', 'six half', 'half six past', 'past half six'], answer: 0, explanation: '6:30 = half past six (30 minutes after six).' },
  { id: 'a2-20', level: 'A2', category: 'Vocabulary', prompt: "Opposite of 'early'?", choices: ['late', 'fast', 'slow', 'soon'], answer: 0, explanation: 'Early = before the expected time. Late = after it.' },

  // ---------- B1 ----------
  { id: 'b1-01', level: 'B1', category: 'Present perfect', prompt: 'I ___ in Tokyo since 2020.', choices: ['live', 'lived', 'have lived', 'am live'], answer: 2, explanation: "Present perfect + since/for = started in the past and still true now." },
  { id: 'b1-02', level: 'B1', category: 'Conditionals', prompt: 'If it rains tomorrow, we ___ at home.', choices: ['stay', 'will stay', 'would stay', 'stayed'], answer: 1, explanation: 'First conditional: If + present, will + verb (real future possibility).' },
  { id: 'b1-03', level: 'B1', category: 'Phrasal verbs', prompt: 'Please ___ your shoes before entering.', choices: ['take off', 'take on', 'take up', 'take after'], answer: 0, explanation: 'Take off = remove (clothes, shoes). Take after = look like a parent.' },
  { id: 'b1-04', level: 'B1', category: 'Phrasal verbs', prompt: 'I need to ___ this word in a dictionary.', choices: ['look for', 'look up', 'look after', 'look at'], answer: 1, explanation: 'Look up = search for information in a book or online.' },
  { id: 'b1-05', level: 'B1', category: 'Prepositions', prompt: "She's interested ___ photography.", choices: ['on', 'at', 'in', 'about'], answer: 2, explanation: "Interested IN something. (Good AT, worried ABOUT.)" },
  { id: 'b1-06', level: 'B1', category: 'Present perfect', prompt: "He's worked here ___ five years.", choices: ['since', 'for', 'from', 'during'], answer: 1, explanation: "'For' + a length of time (five years). 'Since' + a starting point (2020)." },
  { id: 'b1-07', level: 'B1', category: 'Passive', prompt: 'This bridge ___ in 1990.', choices: ['built', 'was built', 'is building', 'has build'], answer: 1, explanation: 'Passive past: was/were + past participle. The bridge did not build itself!' },
  { id: 'b1-08', level: 'B1', category: 'Vocabulary', prompt: "'Exhausted' means very ___.", choices: ['tired', 'angry', 'happy', 'hungry'], answer: 0, explanation: 'Exhausted = extremely tired.' },
  { id: 'b1-09', level: 'B1', category: 'Grammar', prompt: "I'm not used to ___ up early.", choices: ['get', 'getting', 'got', 'gets'], answer: 1, explanation: "'Be used to' + -ing = be familiar with something." },
  { id: 'b1-10', level: 'B1', category: 'Relative clauses', prompt: 'The woman ___ lives next door is a doctor.', choices: ['which', 'who', 'whose', 'where'], answer: 1, explanation: "'Who' (or 'that') for people; 'which' for things." },
  { id: 'b1-11', level: 'B1', category: 'Modal verbs', prompt: "You ___ wear a seatbelt. It's the law.", choices: ['must', 'might', 'could', 'would'], answer: 0, explanation: "'Must' = strong obligation. 'Might/could' = possibility." },
  { id: 'b1-12', level: 'B1', category: 'Collocations', prompt: 'Everyone can ___ a mistake.', choices: ['do', 'make', 'take', 'have'], answer: 1, explanation: "We MAKE mistakes (and make a decision, make a plan)." },
  { id: 'b1-13', level: 'B1', category: 'Conjunctions', prompt: 'Neither Tom ___ Anna came.', choices: ['or', 'nor', 'and', 'but'], answer: 1, explanation: "Neither … nor (= not this one and not that one). Either … or." },
  { id: 'b1-14', level: 'B1', category: 'Reported speech', prompt: '"I am tired." → She said she ___ tired.', choices: ['is', 'was', 'were', 'be'], answer: 1, explanation: 'Reported speech moves one tense back: am → was.' },
  { id: 'b1-15', level: 'B1', category: 'Wishes', prompt: 'I wish I ___ more free time.', choices: ['have', 'had', 'will have', 'having'], answer: 1, explanation: "Wish + past simple = you want the present to be different." },
  { id: 'b1-16', level: 'B1', category: 'Vocabulary', prompt: "Same meaning as 'begin'?", choices: ['finish', 'start', 'stop', 'end'], answer: 1, explanation: 'Begin = start. The others mean the opposite.' },
  { id: 'b1-17', level: 'B1', category: 'Superlatives', prompt: "It's the ___ movie I've ever seen.", choices: ['worse', 'baddest', 'worst', 'most bad'], answer: 2, explanation: 'Bad → worse → worst (irregular).' },
  { id: 'b1-18', level: 'B1', category: 'Indirect questions', prompt: 'Could you tell me where ___?', choices: ['is the station', 'the station is', 'station is the', 'is station'], answer: 1, explanation: 'Indirect questions use statement word order: where the station is.' },
  { id: 'b1-19', level: 'B1', category: 'Phrasal verbs', prompt: 'The plane ___ at 9 a.m.', choices: ['took off', 'took over', 'took after', 'took in'], answer: 0, explanation: 'Take off = a plane leaving the ground.' },
  { id: 'b1-20', level: 'B1', category: 'Grammar', prompt: 'Despite ___ tired, she won the race.', choices: ['be', 'being', 'she was', 'to be'], answer: 1, explanation: "'Despite' is followed by a noun or -ing form: despite being." },

  // ---------- B2 ----------
  { id: 'b2-01', level: 'B2', category: 'Conditionals', prompt: 'If I had studied, I ___ the exam.', choices: ['would pass', 'would have passed', 'will pass', 'had passed'], answer: 1, explanation: 'Third conditional: If + had + p.p., would have + p.p. (imaginary past).' },
  { id: 'b2-02', level: 'B2', category: 'Idioms', prompt: "'Break the ice' means…", choices: ['start a conversation', 'break something', 'feel cold', 'cancel a plan'], answer: 0, explanation: 'Break the ice = make people feel relaxed and start talking.' },
  { id: 'b2-03', level: 'B2', category: 'Idioms', prompt: "'It's a piece of cake' means it's…", choices: ['delicious', 'very easy', 'expensive', 'boring'], answer: 1, explanation: 'A piece of cake = very easy to do.' },
  { id: 'b2-04', level: 'B2', category: 'Past perfect', prompt: 'By the time we arrived, the film ___.', choices: ['started', 'has started', 'had started', 'was start'], answer: 2, explanation: 'Past perfect (had + p.p.) = earlier of two past actions.' },
  { id: 'b2-05', level: 'B2', category: 'Gerunds', prompt: 'She suggested ___ a taxi.', choices: ['to take', 'taking', 'take', 'took'], answer: 1, explanation: "'Suggest' + -ing (or suggest that…). Not 'suggest to do'." },
  { id: 'b2-06', level: 'B2', category: 'Vocabulary', prompt: "'Reluctant' means…", choices: ['unwilling', 'excited', 'careful', 'lucky'], answer: 0, explanation: "Reluctant = not wanting to do something." },
  { id: 'b2-07', level: 'B2', category: 'Inversion', prompt: 'Hardly ___ the house when it rained.', choices: ['I had left', 'had I left', 'I left', 'did I leave'], answer: 1, explanation: "After 'Hardly / No sooner' at the start, invert: had I left." },
  { id: 'b2-08', level: 'B2', category: 'Gerunds', prompt: 'He denied ___ the window.', choices: ['breaking', 'to break', 'break', 'broke'], answer: 0, explanation: "'Deny' + -ing: he denied breaking it." },
  { id: 'b2-09', level: 'B2', category: 'Idioms', prompt: "'Once in a blue moon' means…", choices: ['very rarely', 'every month', 'at night', 'when sad'], answer: 0, explanation: 'Once in a blue moon = almost never.' },
  { id: 'b2-10', level: 'B2', category: 'Grammar', prompt: "I'd rather you ___ smoke in here.", choices: ["don't", "didn't", "won't", 'not'], answer: 1, explanation: "'Would rather' + another person + past simple: I'd rather you didn't." },
  { id: 'b2-11', level: 'B2', category: 'Vocabulary', prompt: "Which word means 'once a year'?", choices: ['annual', 'biannual', 'monthly', 'eventual'], answer: 0, explanation: 'Annual = every year. Biannual = twice a year.' },
  { id: 'b2-12', level: 'B2', category: 'Comparatives', prompt: 'The more you practise, ___ you get.', choices: ['the better', 'better', 'the best', 'more better'], answer: 0, explanation: 'Double comparative: the more …, the better …' },
  { id: 'b2-13', level: 'B2', category: 'Grammar', prompt: "It's high time we ___.", choices: ['leave', 'left', 'will leave', 'leaving'], answer: 1, explanation: "'It's (high) time' + past simple = we should do it now." },
  { id: 'b2-14', level: 'B2', category: 'Phrasal verbs', prompt: "I can't ___ with this noise anymore.", choices: ['put up', 'put off', 'put out', 'put on'], answer: 0, explanation: 'Put up with = tolerate. Put off = postpone.' },
  { id: 'b2-15', level: 'B2', category: 'Inversion', prompt: 'Not only ___ late, he also lost the tickets.', choices: ['he was', 'was he', 'he is', 'is he'], answer: 1, explanation: "'Not only' at the start → inversion: not only was he late…" },
  { id: 'b2-16', level: 'B2', category: 'Vocabulary', prompt: "'Meticulous' means very…", choices: ['careful', 'lazy', 'loud', 'fast'], answer: 0, explanation: 'Meticulous = paying great attention to every detail.' },
  { id: 'b2-17', level: 'B2', category: 'Modal perfect', prompt: "She's not here. She must ___ the bus.", choices: ['miss', 'have missed', 'missed', 'missing'], answer: 1, explanation: "Must have + p.p. = a confident guess about the past." },
  { id: 'b2-18', level: 'B2', category: 'Word forms', prompt: 'His ___ surprised everyone.', choices: ['decide', 'decisive', 'decision', 'decided'], answer: 2, explanation: 'After "his" we need a noun: decision. Decisive is an adjective.' },
  { id: 'b2-19', level: 'B2', category: 'Idioms', prompt: "'Hit the books' means…", choices: ['study hard', 'fight', 'throw books', 'go shopping'], answer: 0, explanation: 'Hit the books = start studying seriously.' },
  { id: 'b2-20', level: 'B2', category: 'Vocabulary', prompt: "'Ubiquitous' means…", choices: ['everywhere', 'rare', 'ancient', 'invisible'], answer: 0, explanation: 'Ubiquitous = found everywhere (e.g. smartphones are ubiquitous).' },
];
