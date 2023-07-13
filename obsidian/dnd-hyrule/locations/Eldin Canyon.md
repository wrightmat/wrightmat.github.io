#location [[Eldin Region]]

Eldin Canyon is a vast area within Eldin, comprising of almost the entirety of the Region. The Canyon primarily covers southern and central Eldin, and stretches to the far northeast along the ends of Hyrule. The southern portion of the Canyon is a valley with rolling foothills that borders along Great Hyrule Forest, Hyrule Field, and northern Lanayru.

The lava that once flowed throughout all of Death Mountain and Eldin Canyon prior to the Upheaval has not returned to the Eldin Canyon area (although it has to Death Mountain and the rivers that surround it). For this reason, gaining access to Goron City and other locations is much easier for outsiders.

### Locations

* [[Foothill Stable]]
* [[Goron City]]
* Broca Island
* Cephla Lake
* Darb Pond
* Gero Pond
* Golow Elevator
* Gorko Lake
* Gorko Tunnel
* Goro Cove
* Goron Hot Springs
* Goronbi Lake and River
* Gortram Cliff
* Lake Intenoch
* Medingo Pool
* Stolock Bridge

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

### Collecting

##### Foraging

| d12  | Collectible          | Qty (12) |
| ---- | -------------------- | -------- |
| 1-3  | Sunshroom            | 3        |
| 4-6  | Hylian Shroom        | 3        |
| 7-8  | Hylian Tomato Pepper | 2        |
| 9-10 | Firefruit           | 2        |
| 11   | Rushroom             | 1        |
| 12   | Fairy                | 1        |
^eldin-canyon-foraging

##### Fishing

| d6  | Collectible     | Qty (6) |
| --- | --------------- | ------- |
| 1-6 | Sizzlefin Trout | 6       |
^eldin-canyon-fishing
