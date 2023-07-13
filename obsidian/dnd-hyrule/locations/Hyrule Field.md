#location [[Central Region]]

Hyrule Field takes up the majority of the Central region. It was littered heavily with ruins during the Calamity and prior to the Upheaval, but has been successfully cleaned up and settled in the time since. Many have moved to new locations such as Windvane Village or Lon Lon Ranch. Roads through Hyrule Field also lead to the Great Plateau, as well as many other regions of Hyrule.

### Locations

* [[Central Research Base]]
* [[Hyrule Field Tower]]
* [[Lon Lon Ranch]]
* [[Windvane Village]]
* [[Maku Tree Sapling]]
* [[Outskirt Stable]]
* Passeri Greenbelt
* Mabe Prairie
* Mount Gustaf
* Whistling Hill
* Lake Kolomo
* Satori Mountain
* Sanidin Park

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12 | Collectible          | Qty (12) |
| --- | -------------------- | -------- |
| 1-2 | Hyrule Herb          | 2        |
| 3-4 | Hylian Shroom        | 2        |
| 5-6 | Hylian Grains        | 2        |
| 7-8 | Apple                | 2        |
| 9   | Hylian Tomato Pepper | 1        |
| 10  | Courser Bee Honey    | 1        |
| 11  | Endura Carrot        | 1        |
| 12  | Stamella Shroom      | 1        |
^hyrule-field-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-5 | Hyrule Bass    | 5       |
| 6   | Staminoka Bass | 1       |
^hyrule-field-fishing
