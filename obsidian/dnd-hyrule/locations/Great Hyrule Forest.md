#location [[Eldin Region]]

The Great Hyrule Forest is a large wooded area in northern Hyrule. The area is characterized by its woodlands and rolling hills that extend to the Eldin Mountains further north. Its most notable landmark are the Lost Woods in its center, a dense forest that is surrounded by an enormous gorge known as Lake Mekar. Along with the Lost Woods, the Great Hyrule Forest consists of multiple smaller woodlands that together make up the entire Forest.

### Locations

* [[Woodland Stable]]
* Lake Mekar
* Lake Saria
* Lost Woods
* Mekar Island
* Mido Swamp
* Minshi Woods

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

* Should do something with the Minshi Woods, like a rumor that strange things have been seen there at night and if the players investigate then they're shrunk down to Minish size!

### Collecting

##### Foraging

| d12  | Collectible    | Qty (12) |
| ---- | -------------- | -------- |
| 1-3  | Apple          | 3        |
| 4-6  | Bird Egg       | 3        |
| 7-8  | Ironshroom     | 2        |
| 9-10 | Razorshroom    | 2        |
| 11   | Hearty Truffle | 1        |
| 12   | Fairy          | 1        |
^great-hyrule-forest-foraging

##### Fishing

| d6  | Collectible      | Qty (6) |
| --- | ---------------- | ------- |
| 1-6 | Stealthfin Trout | 6       |
^great-hyrule-forest-fishing
