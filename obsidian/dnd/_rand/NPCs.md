### **NPCs by Attitude**
```dataview
LIST rows.file.link FROM #npc WHERE Attitude GROUP BY Attitude
```

### **NPCs by Gender**
```dataview
LIST rows.file.link FROM #npc WHERE Gender GROUP BY Gender
```

### **NPCs by Occupation**
```dataview
LIST rows.file.link FROM #npc WHERE Occupation GROUP BY Occupation
```

### **NPCs by Race**
```dataview
LIST rows.file.link FROM #npc WHERE Race GROUP BY Race
```






### Random NPC Tables
##### Type

| dice: 1d100 | Type           |
| ----------- | -------------- |
| 01-05       | Acolyte        |
| 06-10       | Assassin       |
| 11-15       | Bandit         |
| 16-20       | Bandit Captain |
| 21-25       | Berserker      |
| 26-35       | Commoner       |
| 36-40       | Cultist        |
| 41-45       | Cult Fanatic   |
| 46-50       | Druid          |
| 51-55       | Gladiator      |
| 56-60       | Guard          |
| 61-65       | Knight         |
| 66-70       | Mage           |
| 71-75       | Noble          |
| 76-80       | Priest         |
| 81-85       | Scout          |
| 86-88       | Spy            |
| 89-92       | Thug           |
| 93-96       | Tribal Warrior |
| 97-100      | Veteran        |
^random-npc-type

##### Race

| dice: 1d100 | Race       | Age                  | Height | Weight | Speed |
| ----------- | ---------- | -------------------- | ------ | ------ | ----- |
| 01-03       | Changeling | `dice: 1d[16, 100]`  |        |        |       |
| 04-06       | Dragonborn | `dice: 1d[15, 90]`   |        |        |       |
| 07-15       | Dwarf      | `dice: 1d[50, 360]`  |        |        |       |
| 16-24       | Elf        | `dice: 1d[100, 760]` |        |        |       |
| 25-35       | Gnome      | `dice: 1d[40, 460]`  |        |        |       |
| 36-39       | Goblinoid  | `dice: 1d[40, 260]`  |        |        |       |
| 40-60       | Half-Elf   |  `dice: 1d[20, 200]`                    |        |        |       |
| 61-68       | Half-Orc   | `dice: 1d[14, 80]`                     |        |        |       |
| 69-79       | Halfling   |  `dice: 1d[20, 260]`                    |        |        |       |
| 80-86       | Human      |  `dice: 1d[18, 100]`                    |        |        |       |
| 87-90       | Kalashtar  |  `dice: 1d[18, 100]`                    |        |        |       |
| 91-93       | Orc        | `dice: 1d[12, 50]`                     |        |        |       |
| 94-96       | Shifter    | `dice: 1d[10, 75]`                     |        |        |       |
| 97          | Tiefling   | `dice: 1d[18, 110]`                     |        |        |       |
| 98-00       | Warforged  |  `dice: 1d[2, 50]`                    |        |        |       |
^random-npc-race

##### Gender

| dice: 4d8 | Gender     | Pronouns  |
| --------- | ---------- | --------- |
| 01-03     | Non-Binary | they/them |
| 04-17     | Male       | he/him    |
| 18-31     | Female     | she/her   |
| 32        | Other      | xe/xir    |
^random-npc-gender

##### Orientation

| dice: 4d8 | Orientation  |
| --------- | ------------ |
| 01-03     | Bisexual     |
| 04-28     | Heterosexual |
| 29-31     | Homosexual   |
| 32        | Asexual      |
^random-npc-orientation

##### Relationship

| dice: 4d8 | Relationship                  |
| --------- | ----------------------------- |
| 01-02     | Recently divorced             |
| 03-15     | Single                        |
| 16-24     | Married                       |
| 25-31     | In a relationship             |
| 32        | Seeing someone who is married |
^random-npc-relationship

##### Appearance

| dice:1d20 | Appearance                                                  |
| --------- | ----------------------------------------------------------- |
| 1         | Distinctive jewelry: earrings, necklace, circlet, bracelets |
| 2         | Piercings                                                   |
| 3         | Flamboyant or outlandish clothes                            |
| 4         | Formal, clean clothes                                       |
| 5         | Ragged, dirty clothes                                       |
| 6         | Pronounced scar                                             |
| 7         | Missing teeth                                               |
| 8         | Missing fingers                                             |
| 9         | Unusual eye color (or two different colors)                 |
| 10        | Tattoos                                                     |
| 11        | Birthmark                                                   |
| 12        | Unusual skin color                                          |
| 13        | Bald                                                        |
| 14        | Braided beard or hair                                       |
| 15        | Unusual hair color                                          |
| 16        | Nervous eye twitch                                          |
| 17        | Distinctive nose                                            |
| 18        | Distinctive posture (crooked or rigid)                      |
| 19        | Exceptionally beautiful                                     |
| 20        | Exceptionally ugly                                          |
^random-npc-appearance

##### Talents

| dice:1d20 | Talents                              |
| --------- | ------------------------------------ |
| 1         | Plays a musical instrument           |
| 2         | Speaks several languages fluently    |
| 3         | Unbelievably lucky                   |
| 4         | Perfect memory                       |
| 5         | Great with animals                   |
| 6         | Great with children                  |
| 7         | Great at solving puzzles             |
| 8         | Great at one game                    |
| 9         | Great at impersonations              |
| 10        | Draws beautifully                    |
| 11        | Paints beautifully                   |
| 12        | Sings beautifully                    |
| 13        | Drinks everyone under the table      |
| 14        | Expert carpenter                     |
| 15        | Expert cook                          |
| 16        | Expert dart thrower and rock skipper |
| 17        | Expert juggler                       |
| 18        | Skilled actor and master of disguise |
| 19        | Skilled dancer                       |
| 20        | Knows thieves' cant                  |
^random-npc-talents

##### Mannerisms

| dice: 1d20 | Mannerism                                       |
| ---------- | ----------------------------------------------- |
| 1          | Prone to singing, whistling, or humming quietly |
| 2          | Speaks in rhyme or some other peculiar way      |
| 3          | Particularly low or high voice                  |
| 4          | Slurs words, lisps, or stutters                 |
| 5          | Enunciates overly clearly                       |
| 6          | Speaks loudly                                   |
| 7          | Whispers                                        |
| 8          | Uses flowery speech or long words               |
| 9          | Frequently uses the wrong word                  |
| 10         | Uses colorful oaths and exclamations            |
| 11         | Makes constant jokes or puns                    |
| 12         | Prone to predictions of doom                    |
| 13         | Fidgets                                         |
| 14         | Squints                                         |
| 15         | Stares into the distance                        |
| 16         | Chews something                                 |
| 17         | Paces                                           |
| 18         | Taps fingers                                    |
| 19         | Bites fingernails                               |
| 20         | Twirls hair or tugs beard                       |
^random-npc-mannerisms

##### Interactions

| dice: 1d12 | Interaction   |
| ---------- | ------------- |
| 1          | Argumentative |
| 2          | Arrogant      |
| 3          | Blustering    |
| 4          | Rude          |
| 5          | Curious       |
| 6          | Friendly      |
| 7          | Honest        |
| 8          | Hot tempered  |
| 9          | Irritable     |
| 10         | Ponderous     |
| 11         | Quiet         |
| 12         | Suspicious    |
^random-npc-interactions

##### Bonds

| dice: 1d10 | Bond                                         |
| ---------- | -------------------------------------------- |
| 1          | Dedicated to fulfilling a personal life goal |
| 2          | Protective of close family members           |
| 3          | Protective of colleagues or compatriots      |
| 4          | Loyal to a benefactor, patron, or employer   |
| 5          | Captivated by a romantic interest            |
| 6          | Drawn to a special place                     |
| 7          | Protective of a sentimental keepsake         |
| 8          | Protective of a valuable possession          |
| 9          | Out for revenge                              |
| 10         | None                                         |
^random-npc-bonds

##### Flaws

| dice: 1d12 | Flaw                                             |
| ---------- | ------------------------------------------------ |
| 1          | Forbidden love or susceptibility to romance      |
| 2          | Enjoys decadent pleasures                        |
| 3          | Arrogance                                        |
| 4          | Envies another creature's possessions or station |
| 5          | Overpowering greed                               |
| 6          | Prone to rage                                    |
| 7          | Has a powerful enemy                             |
| 8          | Specific phobia                                  |
| 9          | Shameful or scandalous history                   |
| 10         | Secret crime or misdeed                          |
| 11         | Possession of forbidden lore                     |
| 12         | Foolhardy bravery                                |
^random-npc-flaws

##### Attitude

| dice: 4d8 | Attitude    |
| --------- | ----------- |
| 01-02     | Hostile     |
| 03-09     | Unfriendly  |
| 10-23     | Indifferent |
| 24-30     | Friendly    |
| 31-32     | Helpful     |
^random-npc-attitudes

##### Alignment

| dice: 1d3 | Alignment |
| --------- | --------- |
| 1         | Lawful    |
| 2         | Neutral   |
| 3         | Chaotic   |
^random-npc-alignments-1

| dice: 1d3 | Alignment |
| --------- | --------- |
| 1         | Good    |
| 2         | Neutral   |
| 3         | Evil   |
^random-npc-alignments-2

##### Ideals

| 1d6 | Ideal (Good)   |
| --- | -------------- |
| 1   | Beauty         |
| 2   | Charity        |
| 3   | Greater good   |
| 4   | Life           |
| 5   | Respect        |
| 6   | Self-sacrifice |
^random-npc-ideals-g

| 1d6 | Ideal (Evil) |
| --- | ------------ |
| 1   | Domination   |
| 2   | Greed        |
| 3   | Might        |
| 4   | Pain         |
| 5   | Retribution  |
| 6   | Slaughter    |
^random-npc-ideals-e

| 1d6 | Ideal (Lawful) |
| --- | -------------- |
| 1   | Community      |
| 2   | Fairness       |
| 3   | Honor          |
| 4   | Logic          |
| 5   | Responsibility |
| 6   | Tradition      |
^random-npc-ideals-l

| 1d6 | Ideal (Chaotic) |
| --- | --------------- |
| 1   | Change          |
| 2   | Creativity      |
| 3   | Freedom         |
| 4   | Independence    |
| 5   | No limits       |
| 6   | Whimsy          |
^random-npc-ideals-c

| 1d6 | Ideal (Neutral)   |
| --- | ----------------- |
| 1   | Balance           |
| 2   | Knowledge         |
| 3   | Live and let live |
| 4   | Moderation        |
| 5   | Neutrality        |
| 6   | People            |
^random-npc-ideals-n

| 1d6 | Ideal          |
| --- | -------------- |
| 1   | Aspiration     |
| 2   | Discovery      |
| 3   | Glory          |
| 4   | Nation         |
| 5   | Redemption     |
| 6   | Self-knowledge |
^random-npc-ideals-o
