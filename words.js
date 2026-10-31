// Keystroke word source. Plain lower-case everyday words; punctuation and numbers are added by engine.js.
// "common" holds the 200 most frequent words; "more" adds about 200 everyday words with a wider spread of letters.
window.KS_WORDS = { common: [], more: [], sentences: [] };

// Common, chunk 1 of 2
window.KS_WORDS.common.push(...`
the be to of and a in that have it for not on with he as you do at this but his by from
they we say her she or an will my one all would there their what so up out if about who get
which go me when make can like time no just him know take people into year your good some
could them see other than then now look only come its over think also back after use two how
our work first well way even new want because any these give day most us
`.trim().split(/\s+/));

// Common, chunk 2 of 2
window.KS_WORDS.common.push(...`
is was are has had been find here thing many tell very through long where much should down
off still own last never before same great old life right big while might school
home house water room mother father point world place hand part week night name car city
small number read show turn start help move live keep close open run walk talk write
learn change follow stop play leave call try ask need feel seem hear let mean put bring
begin each those both such every always again around between under head side money ever
`.trim().split(/\s+/));

// More, chunk 1 of 2
window.KS_WORDS.more.push(...`
quick quiet quite queen quiz question square equal liquid jacket juice joke join jump jelly
journey judge major object project enjoy zero zone zip lazy prize size dozen frozen puzzle
amaze breeze freeze box fox six mix fix next text extra exact exam taxi relax wax tax index
yellow yard yawn young youth yoga kitchen kettle knife knock kind key keep market basket
blanket pocket rocket ticket monkey whisky valley vivid visit voice value van vest wave
brave above seven over every river level travel silver village vote velvet
`.trim().split(/\s+/));

// More, chunk 2 of 2
window.KS_WORDS.more.push(...`
bread butter coffee pepper apple banana garden flower window pillow mirror bottle cable
phone laptop pencil paper letter parcel planet bridge island forest mountain ocean beach
cloud storm thunder rain snow summer winter autumn spring morning evening dinner lunch
picnic party music guitar piano movie camera picture colour orange purple green silver
gold metal wood stone glass cotton leather wheel engine motor bicycle helmet ladder hammer
bucket shovel carpet curtain button pocket napkin plate spoon fork bowl cup towel soap brush
`.trim().split(/\s+/));

// More, chunk 3: a few extra everyday words
window.KS_WORDS.more.push(...`
family friend people story reason answer problem moment minute hour today tomorrow yesterday
weekend holiday office doctor teacher student driver farmer baker neighbour cousin uncle
simple happy sunny cloudy windy busy empty heavy gentle careful honest lucky proud tired
hungry thirsty bright clever silly fancy cosy fresh crisp sweet sour bitter salty smooth
carry cook clean wash sleep sing dance swim climb draw paint smile laugh listen share plant
pack wrap fold pour stir bake boil fry chop slice grab throw catch kick
`.trim().split(/\s+/));

// Sentences mode: short, plain, original everyday sentences.
window.KS_WORDS.sentences = [
  "The kettle clicked off just as the bus went past.",
  "We left the beach early because the wind turned cold.",
  "She keeps a spare key under the blue pot by the door.",
  "My brother always burns the toast and blames the toaster.",
  "The shop on the corner sells fresh bread until noon.",
  "I forgot my umbrella, so I waited under the bridge.",
  "Our team meets every Monday to plan the week ahead.",
  "The cat sleeps on the warm side of the couch.",
  "He fixed the wobbly chair with two screws and some glue.",
  "Please turn the music down a little after nine.",
  "The train was late, but nobody seemed to mind.",
  "We planted tomatoes along the back fence in spring.",
  "Bring a jacket, because it gets windy near the river.",
  "The library is quiet on Sunday mornings.",
  "She ran the last lap faster than anyone expected.",
  "Dinner tonight is soup, salad and the rest of the rice.",
  "The new phone came with a cable but no charger.",
  "A small dog followed us all the way to the park.",
  "I wrote a shopping list and then left it at home.",
  "The sun came out just after we packed up the picnic.",
  "Grandma calls every Friday to ask about school.",
  "Most of the leaves fell from the tree in one night."
];

// Build the two pools used by the difficulty option. Duplicates are removed so every word is equally likely.
(function (W) {
  W.common = Array.from(new Set(W.common));
  W.all = Array.from(new Set(W.common.concat(W.more)));
})(window.KS_WORDS);
