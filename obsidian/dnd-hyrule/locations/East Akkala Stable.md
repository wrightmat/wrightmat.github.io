#location #stable [[Deep Akkala]]

>You've been told that the East Akkala Stable is a place where adventurers could find respite in a more laid back environment than the rigid Citadel Town. Also the food and drink are universally praised here. As you enter the stable, you see a number of people sitting around tables chatting. One table of Hylian men give you an untrusting look and immediately start whispering to each other.

If the players approach anyone in the stable, they recall a tale told to them. Roll a d6 and consult the Akkala Rumors table, or pick a tale the characters haven't heard yet. Outside, Kaifa tends to the massive number of sheep that she's bred at the stable over the years.

Primary-Purpose:: Sheep
Region:: Akkala

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

### Notice Board

 - "Looking for brave souls to explore the ancient labyrinth off the coast of northeastern Akkala. If interested, see Jerrin at the Ancient Tech Lab."
