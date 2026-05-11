import { Scene } from '@/lib/types/livebook';

const BOOK_ID = 'ramayana-livebook';

export const ramayanaScenes: Scene[] = [
  {
    id: 'scene-1', book_id: BOOK_ID, scene_id: 'ayodhya_intro',
    title: 'The Princes of Ayodhya', order_index: 1,
    narration: 'Long ago, in the golden city of Ayodhya, King Dasharatha ruled a prosperous kingdom with wisdom and love. He was blessed with four sons: Rama, Bharata, Lakshmana, and Shatrughna. Among them, Rama shone brightest — calm, truthful, and compassionate. The great sage Vishwamitra arrived one day, seeking Rama and Lakshmana\'s help to protect sacred rituals from dark forces. Thus began the journey that would shape the world.',
    short_summary: 'Meet King Dasharatha and the princes of Ayodhya.',
    visual_description: 'Grand palace of Ayodhya at golden hour, ornate pillars, royal courtyard with the king on his throne, princes standing before him, sage Vishwamitra arriving at the gates.',
    background_asset_url: '/images/scene_ayodhya_intro.png', previous_scene_id: null, next_scene_id: 'mithila_bow',
    mode: 'story',
    learning_points: ['Ayodhya was a prosperous and just kingdom.', 'Rama was known for truth and compassion from youth.', 'Sages and kings worked together to protect dharma.'],
    quiz_questions: [],
    source_notes: 'Based on Bala Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_ayodhya_intro_beat_1.png', visualDescription: 'A sweeping wide shot of the grand palace of Ayodhya during golden hour, showcasing ornate pillars and the royal courtyard. King Dasharatha sits majestically on his throne, surrounded by his four sons: Rama, Bharata, Lakshmana, and Shatrughna, who stand proudly before him, embodying the spirit of the prosperous kingdom.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_ayodhya_intro_beat_2.png', visualDescription: 'A close-up of Rama\'s face, capturing his calm and compassionate expression as he listens intently. His eyes reflect wisdom and determination, embodying the qualities that set him apart as the brightest of the princes.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_ayodhya_intro_beat_3.png', visualDescription: 'A dynamic shot as sage Vishwamitra arrives at the gates of the palace, his aura radiating authority and urgency. The princes, Rama and Lakshmana, exchange a determined glance, recognizing the significance of the sage\'s visit and the call to action.', motion: 'pan_right' },
      { imageUrl: '/images/scene_ayodhya_intro_beat_4.png', visualDescription: 'A close-up of King Dasharatha\'s concerned expression as he contemplates the sage\'s request for help. The weight of responsibility is evident on his brow, foreshadowing the challenges that lie ahead for his sons.', motion: 'fade_only' },
      { imageUrl: '/images/scene_ayodhya_intro_beat_5.png', visualDescription: 'A shot capturing Rama and Lakshmana stepping forward confidently, ready to accept the sage\'s challenge. The background blurs slightly, emphasizing their resolve and the beginning of a pivotal journey.', motion: 'battle_push' }
    ],
  },
  {
    id: 'scene-2', book_id: BOOK_ID, scene_id: 'mithila_bow',
    title: 'Sita and the Bow of Shiva', order_index: 2,
    narration: 'In the kingdom of Mithila, King Janaka held a great challenge: whoever could lift and string the mighty bow of Shiva would win the hand of his daughter, Sita. Many powerful kings tried and failed. When Rama stepped forward, he not only lifted the bow but broke it with ease. The assembly watched in awe. Sita placed the garland around Rama\'s neck. Their union was celebrated across both kingdoms.',
    short_summary: 'Rama breaks the bow of Shiva and marries Sita.',
    visual_description: 'Grand assembly hall of Mithila, massive ornate bow at center, Rama lifting it, Sita watching with hope, King Janaka on his throne, crowd in amazement.',
    background_asset_url: '/images/scene_mithila_bow.png', previous_scene_id: 'ayodhya_intro', next_scene_id: 'exile',
    mode: 'story',
    learning_points: ['True strength is calm and purposeful.', 'Sita chose Rama for his virtue, not just strength.', 'Great challenges reveal great character.'],
    quiz_questions: [],
    source_notes: 'Based on Bala Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_mithila_bow_beat_1.png', visualDescription: 'Wide shot of the grand assembly hall of Mithila during the day, filled with courtiers and dignitaries. King Janaka sits on his ornate throne, Sita stands with hope in her eyes, while powerful kings surround the massive bow of Shiva at the center.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_mithila_bow_beat_2.png', visualDescription: 'Close-up of Rama\'s determined expression as he grips the mighty bow of Shiva, sweat glistening on his brow, showcasing his strength and resolve.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_mithila_bow_beat_3.png', visualDescription: 'Mid-shot of Rama effortlessly lifting the bow above his head, the assembly gasping in shock and awe, with King Janaka raising an eyebrow in disbelief.', motion: 'battle_push' },
      { imageUrl: '/images/scene_mithila_bow_beat_4.png', visualDescription: 'Close-up of Sita\'s radiant smile as she places a garland around Rama’s neck, her eyes sparkling with joy, while the crowd erupts in cheers behind them.', motion: 'fade_only' },
      { imageUrl: '/images/scene_mithila_bow_beat_5.png', visualDescription: 'Wide shot of the entire assembly celebrating, with confetti falling and joyous expressions all around, as Rama and Sita stand together, united.', motion: 'slow_zoom_out' }
    ],
  },
  {
    id: 'scene-3', book_id: BOOK_ID, scene_id: 'exile',
    title: 'The Exile', order_index: 3,
    narration: 'Rama was chosen to be the next king of Ayodhya. But Queen Kaikeyi, reminded of an old promise by Dasharatha, demanded that her son Bharata become king and Rama be exiled for fourteen years. Dasharatha\'s heart shattered, but Rama accepted the exile calmly, saying duty and truth must always be honored. Sita and Lakshmana refused to let him go alone. Together, they left the palace for the forest.',
    short_summary: 'Rama accepts exile; Sita and Lakshmana follow.',
    visual_description: 'Emotional scene at Ayodhya palace gates, Rama in simple forest clothes, Sita and Lakshmana beside him, Dasharatha grief-stricken, citizens weeping.',
    background_asset_url: '/images/scene_exile.png', previous_scene_id: 'mithila_bow', next_scene_id: 'forest_life',

    mode: 'story',
    learning_points: ['Rama honored his father\'s word above personal desire.', 'Sita and Lakshmana showed profound loyalty.', 'True duty sometimes requires great sacrifice.'],
    quiz_questions: [],
    source_notes: 'Based on Ayodhya Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_exile_beat_1.png', visualDescription: 'A wide shot of the grand Ayodhya palace gates at dusk, illuminated by torches. Rama stands at the forefront in simple forest clothes, flanked by Sita and Lakshmana, while Dasharatha stands behind them, grief-stricken. Citizens gather, their faces filled with sorrow.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_exile_beat_2.png', visualDescription: 'A close-up of Dasharatha\'s face, tears streaming down his cheeks, portraying deep sorrow and anguish as he looks at Rama. The weight of the decision hangs heavy in his expression.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_exile_beat_3.png', visualDescription: 'A medium shot capturing Rama, Sita, and Lakshmana turning towards the palace gates, preparing to leave. Rama’s calm demeanor contrasts with the emotional turmoil around him, emphasizing his acceptance of exile.', motion: 'battle_push' },
      { imageUrl: '/images/scene_exile_beat_4.png', visualDescription: 'A close-up of Sita’s hand clasping Rama’s, a symbol of unwavering support and commitment. Her expression reveals determination, ready to face the hardships of exile together.', motion: 'fade_only' },
      { imageUrl: '/images/scene_exile_beat_5.png', visualDescription: 'A wide shot as Rama, Sita, and Lakshmana walk away from the palace, the gates receding in the background. Citizens watch with tearful faces, the scene filled with a mix of hope and despair as the trio enters the forest path.', motion: 'pan_left' }
    ],
  },
  {
    id: 'scene-4', book_id: BOOK_ID, scene_id: 'forest_life',
    title: 'Life in the Forest', order_index: 4,
    narration: 'Rama, Sita, and Lakshmana built a peaceful home in the forest at Panchavati. They lived simply among nature, learning from sages and protecting the forest dwellers. One day, a golden deer appeared — enchanting and beautiful. Sita was captivated and asked Rama to catch it. Rama followed the deer into the forest, and Lakshmana was drawn away too. It was a trap.',
    short_summary: 'Forest life is peaceful until the golden deer appears.',
    visual_description: 'Serene forest hermitage, thatched hut, river nearby, Rama and Sita in peaceful setting, then the golden deer appearing at the edge of the clearing.',
    background_asset_url: '/images/scene_forest_life.png', previous_scene_id: 'exile', next_scene_id: 'ravana_jatayu',
    mode: 'story',
    learning_points: ['Simple living can bring great peace.', 'Not everything beautiful is what it seems.', 'Deception can come in attractive forms.'],
    quiz_questions: [],
    source_notes: 'Based on Aranya Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_forest_life_beat_1.png', visualDescription: 'A serene establishing wide shot of the peaceful forest hermitage at Panchavati, showcasing the thatched hut nestled among tall trees, with Rama, Sita, and Lakshmana engaged in daily activities, surrounded by the tranquility of nature. The sun is setting, casting a golden hue over the scene.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_forest_life_beat_2.png', visualDescription: 'A close-up of Sita, her eyes wide with wonder and delight as she gazes at the enchanting golden deer that has just appeared at the edge of the clearing. Her expression reflects both fascination and desire.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_forest_life_beat_3.png', visualDescription: 'A dynamic shot of Rama, bow in hand, as he prepares to chase after the golden deer. His focused expression conveys determination and love for Sita, while Lakshmana stands beside him, ready to follow, capturing the tension of the moment.', motion: 'battle_push' },
      { imageUrl: '/images/scene_forest_life_beat_4.png', visualDescription: 'A close-up of Sita\'s face, now filled with concern and anticipation as she watches Rama and Lakshmana disappear into the dense forest, realizing that their chase may lead to unforeseen dangers.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_forest_life_beat_5.png', visualDescription: 'A wide shot revealing the deep, shadowy forest as Rama and Lakshmana venture further in, the golden deer leading them deeper into the woods, foreshadowing the trap that awaits.', motion: 'pan_left' }
    ],
  },
  {
    id: 'scene-5', book_id: BOOK_ID, scene_id: 'ravana_jatayu',
    title: "Ravana's Deception and Jatayu's Courage", order_index: 5,
    narration: 'With Rama and Lakshmana away, the demon king Ravana arrived disguised as a sage and abducted Sita, carrying her away in his flying chariot. Jatayu, the noble eagle and old friend of Dasharatha, saw Sita\'s distress and attacked Ravana with all his might. Though old and outmatched, Jatayu fought bravely before falling. When Rama found the wounded Jatayu, the eagle told him what happened with his last breaths. Rama wept and honored Jatayu as he would his own father.',
    short_summary: 'Ravana abducts Sita; Jatayu fights bravely.',
    visual_description: 'Dramatic sky scene, Ravana in flying chariot with captive Sita, Jatayu attacking fiercely, feathers and wind, dramatic lighting.',
    background_asset_url: '/images/scene_ravana_jatayu.png', previous_scene_id: 'forest_life', next_scene_id: 'hanuman_meets_rama',
    mode: 'story',
    learning_points: ['Jatayu\'s courage shows that age does not diminish bravery.', 'Ravana\'s power was misused through deception.', 'True sacrifice is acting for others regardless of personal cost.'],
    quiz_questions: [],
    source_notes: 'Based on Aranya Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_ravana_jatayu_beat_1.png', visualDescription: 'A wide shot of the dramatic sky, with Ravana in his ornate flying chariot, soaring above as Sita struggles in his grasp. The sun sets in the background, casting a golden hue over the scene, highlighting the tension of the moment.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_ravana_jatayu_beat_2.png', visualDescription: 'Close-up of Sita\'s face, filled with fear and desperation as she looks back at Ravana, her eyes wide with terror and pleading for help.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_ravana_jatayu_beat_3.png', visualDescription: 'A dynamic action shot of Jatayu, the noble eagle, fiercely attacking Ravana in mid-air, his feathers ruffled by the wind, showcasing his bravery despite his age. Ravana\'s expression shifts to surprise and anger.', motion: 'battle_push' },
      { imageUrl: '/images/scene_ravana_jatayu_beat_4.png', visualDescription: 'A close-up of the wounded Jatayu on the ground, feathers scattered and bloodied, as Rama kneels beside him, sorrow etched on his face, listening intently to Jatayu\'s last words.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_ravana_jatayu_beat_5.png', visualDescription: 'A poignant shot of Rama weeping over Jatayu\'s fallen body, his hand resting on Jatayu\'s head in a gesture of respect, as the background fades into darkness, emphasizing the emotional weight of the moment.', motion: 'pan_left' }
    ],
  },
  {
    id: 'scene-6', book_id: BOOK_ID, scene_id: 'hanuman_meets_rama',
    title: 'The Search and the Meeting with Hanuman', order_index: 6,
    narration: 'Grief-stricken but resolute, Rama and Lakshmana searched the forests for Sita. Their path led them to Kishkindha, where they met Sugriva, the exiled vanara king, and his minister Hanuman. Hanuman felt an instant, deep devotion to Rama. An alliance was formed: Rama would help Sugriva regain his kingdom, and Sugriva would help Rama find Sita. Hanuman pledged his life to Rama\'s cause.',
    short_summary: 'Rama meets Sugriva and Hanuman; an alliance is formed.',
    visual_description: 'Mountain clearing, Rama and Lakshmana meeting Hanuman and Sugriva, the vanara settlement in background, moment of alliance.',
    background_asset_url: '/images/scene_hanuman_meets_rama.png', previous_scene_id: 'ravana_jatayu', next_scene_id: 'hanuman_lanka',
    mode: 'story',
    learning_points: ['True friendship can arise between the most unlikely beings.', 'Alliances built on trust and mutual respect are powerful.', 'Devotion can be instant and transformative.'],
    quiz_questions: [],
    source_notes: 'Based on Kishkindha Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_hanuman_meets_rama_beat_1.png', visualDescription: 'A wide shot of the mountainous forest clearing at dawn, with Rama and Lakshmana standing at the forefront, their expressions a mix of grief and determination. In the background, the vanara settlement of Kishkindha is visible, with Sugriva and Hanuman watching from a distance.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_hanuman_meets_rama_beat_2.png', visualDescription: 'A close-up of Hanuman\'s face, filled with deep devotion and admiration as he gazes at Rama. The light catches his expressive eyes, showcasing the intensity of his emotions.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_hanuman_meets_rama_beat_3.png', visualDescription: 'A dynamic shot capturing the moment of alliance, with Rama extending his hand towards Sugriva, who looks resolute. Hanuman stands beside Sugriva, his posture reflecting loyalty and readiness to pledge his life to Rama\'s cause.', motion: 'battle_push' },
      { imageUrl: '/images/scene_hanuman_meets_rama_beat_4.png', visualDescription: 'A close-up of Rama\'s hand clasping Sugriva\'s, symbolizing the formation of their alliance. The background fades softly, highlighting the significance of this moment.', motion: 'fade_only' },
      { imageUrl: '/images/scene_hanuman_meets_rama_beat_5.png', visualDescription: 'A wide shot of the group, now united, with Rama, Lakshmana, Sugriva, and Hanuman standing together against the backdrop of the forest, ready to embark on their quest. The sun rises higher, illuminating their path ahead.', motion: 'pan_right' }
    ],
  },
  {
    id: 'scene-7', book_id: BOOK_ID, scene_id: 'hanuman_lanka',
    title: "Hanuman's Leap to Lanka", order_index: 7,
    narration: 'Hanuman stood at the edge of the southern ocean. Lanka lay beyond the vast waters. With a mighty leap powered by devotion, Hanuman soared across the sea, overcoming every obstacle. In Lanka, he searched until he found Sita in the Ashoka Vatika, surrounded by guards. He showed her Rama\'s ring as proof and gave her hope. Before leaving, Hanuman let himself be captured to deliver a message to Ravana, then set fire to parts of Lanka as a warning.',
    short_summary: 'Hanuman leaps to Lanka and finds Sita.',
    visual_description: 'Hanuman mid-leap across the ocean, Lanka\'s golden city visible in distance, then Ashoka Vatika garden with Sita under a tree.',
    background_asset_url: '/images/scene_hanuman_lanka.png', previous_scene_id: 'hanuman_meets_rama', next_scene_id: 'bridge_to_lanka',
    mode: 'story',
    learning_points: ['Devotion gives strength beyond measure.', 'Hanuman combined courage with intelligence.', 'Hope can sustain someone through the darkest times.'],
    quiz_questions: [],
    source_notes: 'Based on Sundara Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_hanuman_lanka_beat_1.png', visualDescription: 'A panoramic view of the southern ocean at dawn, with Hanuman standing at the edge of a rocky cliff, gazing determinedly towards the distant golden city of Lanka, shimmering in the early light. The waves crash against the rocks below, emphasizing the vastness of the ocean before him.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_hanuman_lanka_beat_2.png', visualDescription: 'A close-up of Hanuman\'s face, filled with fierce determination and devotion. His brow is furrowed, and his eyes shine with purpose as he prepares to leap across the ocean, the wind tousling his fur and the sunlight glinting off his golden ornaments.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_hanuman_lanka_beat_3.png', visualDescription: 'A dramatic shot capturing Hanuman mid-leap, his powerful form soaring through the air above the ocean, with a backdrop of waves crashing below. The city of Lanka looms closer in the distance, bathed in golden light, symbolizing hope and determination.', motion: 'battle_push' },
      { imageUrl: '/images/scene_hanuman_lanka_beat_4.png', visualDescription: 'Inside the lush Ashoka Vatika, a close-up of Sita\'s face as she gazes at Hanuman with a mix of surprise and hope. The vibrant flowers surround her, and her expression reflects the moment she sees Rama\'s ring, symbolizing connection and love.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_hanuman_lanka_beat_5.png', visualDescription: 'A wide shot of Hanuman, now captured, standing defiantly before Ravana\'s palace. Flames flicker in the background, hinting at the fire he has set in parts of Lanka as a warning. His posture is bold, exuding confidence even in captivity, as he prepares to deliver his message.', motion: 'pan_right' }
    ],
  },
  {
    id: 'scene-8', book_id: BOOK_ID, scene_id: 'bridge_to_lanka',
    title: 'The Bridge to Lanka', order_index: 8,
    narration: 'With the location of Sita confirmed, Rama led the vanara army to the southern shore. The vast ocean lay between them and Lanka. Under the guidance of Nala and Nila, the vanaras began building a great bridge — each stone placed with devotion, each stone floating upon the water as Rama\'s name was written upon them. The bridge stretched across the sea, and the army marched toward Lanka.',
    short_summary: 'The vanara army builds a bridge to Lanka.',
    visual_description: 'Massive bridge being built across the ocean, vanaras carrying stones, Rama overseeing, the bridge stretching toward Lanka on the horizon.',
    background_asset_url: '/images/scene_bridge_to_lanka.png', previous_scene_id: 'hanuman_lanka', next_scene_id: 'battle_lanka',
    mode: 'story',
    learning_points: ['Great tasks require teamwork and faith.', 'Even stones float when placed with devotion and purpose.', 'Unity makes the impossible possible.'],
    quiz_questions: [],
    source_notes: 'Based on Yuddha Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_bridge_to_lanka_beat_1.png', visualDescription: 'A wide shot of the southern shore at dawn, with Rama standing at the forefront, surveying the vast ocean. The vanara army is bustling behind him, preparing for the monumental task ahead. The early morning light casts a golden hue over the scene, illuminating the massive waves crashing against the shore.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_bridge_to_lanka_beat_2.png', visualDescription: 'A close-up of Rama\'s hand as he writes his name in the sand, a look of determination and hope on his face. The intricate detailing of his ornate armor and the rising sun reflecting off his skin emphasize his divine nature.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_bridge_to_lanka_beat_3.png', visualDescription: 'A dynamic shot of the vanara army in action, with Nala and Nila leading the effort. Stones are being lifted and positioned, some floating upon the water. The energy and urgency of the construction are palpable as the bridge begins to take shape, stretching toward Lanka in the distance.', motion: 'battle_push' },
      { imageUrl: '/images/scene_bridge_to_lanka_beat_4.png', visualDescription: 'A medium shot capturing the moment the first stone is set into place, floating effortlessly on the water. The vanaras cheer in celebration, their faces filled with joy and camaraderie as they witness the miracle of the bridge forming under Rama\'s guidance.', motion: 'fade_only' },
      { imageUrl: '/images/scene_bridge_to_lanka_beat_5.png', visualDescription: 'An aerial shot of the completed section of the bridge, with the vanara army marching forward, their silhouettes against the backdrop of the ocean. Rama stands at the forefront, leading his troops with unwavering resolve as the horizon of Lanka beckons.', motion: 'pan_right' }
    ],
  },
  {
    id: 'scene-9', book_id: BOOK_ID, scene_id: 'battle_lanka',
    title: 'The Battle in Lanka', order_index: 9,
    narration: 'The great battle began. Ravana\'s mighty army faced Rama\'s vanara forces. Warriors clashed on both sides. Ravana\'s brother Vibhishana, unable to support injustice, chose to leave Lanka and join Rama — choosing dharma over blind family loyalty. After fierce battles, Rama faced Ravana in single combat. The demon king fell, and Rama mourned even his enemy, recognizing Ravana\'s greatness corrupted by pride.',
    short_summary: 'The battle in Lanka; Vibhishana chooses dharma; Rama defeats Ravana.',
    visual_description: 'Epic battlefield scene, two armies clashing, Vibhishana crossing to Rama\'s side, final duel between Rama and Ravana.',
    background_asset_url: '/images/scene_battle_lanka.png', previous_scene_id: 'bridge_to_lanka', next_scene_id: 'return_ayodhya',
    mode: 'story',
    learning_points: ['Dharma sometimes means standing against those you love.', 'Even a great enemy deserves respect in defeat.', 'Pride unchecked leads to destruction.'],
    quiz_questions: [],
    source_notes: 'Based on Yuddha Kanda of Valmiki Ramayana, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_battle_lanka_beat_1.png', visualDescription: 'An epic wide shot of the battlefield at dawn, with Rama\'s vanara forces on one side and Ravana\'s mighty army on the other, clashing swords and shields. The sky is ablaze with colors, hinting at the intensity of the battle. Rama stands tall, his bow drawn, while Ravana looms ominously in the background, his demon army ready for war.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_battle_lanka_beat_2.png', visualDescription: 'A close-up of Vibhishana\'s face, torn with conflict as he looks towards Rama, determination etched in his features. Tears glisten in his eyes as he makes the decision to abandon his brother Ravana, showing his internal struggle between loyalty and righteousness.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_battle_lanka_beat_3.png', visualDescription: 'A dynamic action shot as Rama and Ravana engage in fierce single combat, their weapons clashing with sparks flying. Rama\'s face shows fierce determination while Ravana\'s features are twisted with pride and rage, capturing the intensity of their duel.', motion: 'battle_push' },
      { imageUrl: '/images/scene_battle_lanka_beat_4.png', visualDescription: 'A poignant shot of Rama standing over the fallen Ravana, sorrow in his eyes. He holds his bow down, his body language reflecting respect for his fallen enemy, acknowledging Ravana\'s greatness even in defeat.', motion: 'pan_left' },
      { imageUrl: '/images/scene_battle_lanka_beat_5.png', visualDescription: 'A wide shot of the battlefield, now quiet and solemn, as Rama turns away from Ravana\'s body, the vanara forces gathering around him. The sun sets in the background, casting a golden hue over the scene, symbolizing the heavy burden of victory.', motion: 'slow_zoom_out' }
    ],
  },
  {
    id: 'scene-10', book_id: BOOK_ID, scene_id: 'return_ayodhya',
    title: 'Return to Ayodhya', order_index: 10,
    narration: 'With Sita rescued and the battle won, Rama, Sita, Lakshmana, and Hanuman flew back to Ayodhya in the Pushpaka Vimana. Bharata, who had faithfully kept Rama\'s sandals on the throne for fourteen years, welcomed his brother with tears of joy. The people of Ayodhya lit thousands of lamps to celebrate Rama\'s return. The city shone like a constellation on earth. Rama was crowned king, and a golden era of justice began.',
    short_summary: 'Rama returns to Ayodhya; the city celebrates with lights.',
    visual_description: 'Ayodhya city lit with thousands of oil lamps, Rama and Sita arriving, Bharata welcoming, joyful crowds, coronation scene.',
    background_asset_url: '/images/scene_return_ayodhya.png', previous_scene_id: 'battle_lanka', next_scene_id: 'lessons',
    mode: 'story',
    learning_points: ['Patience and faith are rewarded.', 'Bharata\'s humility kept the kingdom just.', 'Light overcomes darkness — within and without.'],
    quiz_questions: [],
    source_notes: 'Based on Yuddha Kanda and Uttara Kanda traditions, public-domain.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_return_ayodhya_beat_1.png', visualDescription: 'An establishing wide shot of the city of Ayodhya at dusk, illuminated by thousands of oil lamps, twinkling like stars. Rama, Sita, Lakshmana, and Hanuman are seen arriving in the Pushpaka Vimana, hovering above the city. The grandeur of the city is captured, showcasing its festive spirit.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_return_ayodhya_beat_2.png', visualDescription: 'A close-up of Bharata\'s face, filled with tears of joy as he gazes at Rama\'s return. The deep emotion of relief and happiness is evident, highlighting his unwavering loyalty to his brother.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_return_ayodhya_beat_3.png', visualDescription: 'A dynamic shot of the Pushpaka Vimana landing gracefully, with Rama and Sita stepping out, greeted by a jubilant crowd of Ayodhya residents. The excitement and celebration are palpable as flowers are showered upon them.', motion: 'pan_right' },
      { imageUrl: '/images/scene_return_ayodhya_beat_4.png', visualDescription: 'A close shot of the people of Ayodhya lighting oil lamps, their faces glowing with joy and anticipation. The sense of unity and celebration among the citizens is emphasized as they prepare for Rama\'s coronation.', motion: 'fade_only' },
      { imageUrl: '/images/scene_return_ayodhya_beat_5.png', visualDescription: 'A majestic shot of Rama being crowned king amidst a sea of people, with Sita by his side. The golden crown is placed upon his head, and the atmosphere is filled with divine glow, symbolizing the beginning of a golden era of justice.', motion: 'divine_glow' }
    ],
  },
  {
    id: 'scene-11', book_id: BOOK_ID, scene_id: 'lessons',
    title: 'What the Ramayana Teaches', order_index: 11,
    narration: 'The Ramayana is not just a story — it is a guide for life. Rama teaches us about duty and selfless leadership. Sita teaches dignity and inner courage. Lakshmana teaches unwavering loyalty. Hanuman teaches that devotion and humility make us truly strong. Bharata teaches that power without righteousness has no value. Jatayu teaches that courage has no age. Vibhishana teaches that truth must come before blind loyalty. And Ravana reminds us that knowledge without humility can become dangerous.',
    short_summary: 'The lessons each character teaches us.',
    visual_description: 'Contemplative visual showing all major characters in a collage-style arrangement with their key virtue written beside them, warm golden light.',
    background_asset_url: '/images/scene_lessons.png', previous_scene_id: 'return_ayodhya', next_scene_id: 'closing',
    mode: 'learn',
    learning_points: ['Rama: duty and selfless leadership', 'Sita: dignity and courage', 'Lakshmana: loyalty', 'Hanuman: devotion and humility', 'Bharata: humility and selflessness', 'Jatayu: sacrifice and courage', 'Vibhishana: truth over blind loyalty', 'Ravana: knowledge without humility is dangerous'],
    quiz_questions: [],
    source_notes: 'Synthesized from Ramayana teachings, public-domain traditions.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_lessons_beat_1.png', visualDescription: 'A wide shot of a serene forest glade during twilight, with Rama standing tall and poised at the center, flanked by Sita, Lakshmana, Hanuman, Bharata, Jatayu, Vibhishana, and Ravana. Each character is illuminated by a warm golden light, their key virtues subtly inscribed beside them in the air.', motion: 'slow_zoom_out' },
      { imageUrl: '/images/scene_lessons_beat_2.png', visualDescription: 'A close-up of Sita\'s face, her eyes reflecting determination and inner courage. She is adorned in a beautifully detailed saree, her expression serene yet strong as she gazes towards Rama.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_lessons_beat_3.png', visualDescription: 'A dynamic shot of Hanuman in mid-leap, showcasing his devotion as he reaches towards the sky, his expression a mix of humility and fervor. His hands clasped together in prayer, surrounded by a faint divine glow.', motion: 'battle_push' },
      { imageUrl: '/images/scene_lessons_beat_4.png', visualDescription: 'A close-up of Ravana, his face marked by arrogance yet shadowed by a hint of regret. His ornate crown glistens in the golden light, emphasizing the contrast between his knowledge and the humility he lacks.', motion: 'fade_only' },
      { imageUrl: '/images/scene_lessons_beat_5.png', visualDescription: 'A pan-left shot capturing Jatayu soaring through the sky, wings outstretched, embodying the essence of courage and bravery at any age. The sun sets behind him, casting a dramatic silhouette.', motion: 'pan_left' }
    ],
  },
  {
    id: 'scene-12', book_id: BOOK_ID, scene_id: 'closing',
    title: 'The Light of Dharma', order_index: 12,
    narration: 'The Ramayana has been told and retold for thousands of years across countless cultures and languages. Its power lies not just in its epic events, but in the timeless questions it raises: What does it mean to do the right thing? How do we stay strong when the world tests us? What is true courage, true love, true loyalty? Every generation finds its own answers inside this ancient story. The light of dharma continues to shine.',
    short_summary: 'A closing reflection on the timeless Ramayana.',
    visual_description: 'A single oil lamp (diya) glowing in the center, radiating warm golden light outward, silhouettes of all characters fading into light, peaceful and sacred.',
    background_asset_url: '/images/scene_lessons.png', previous_scene_id: 'lessons', next_scene_id: null,
    mode: 'story',
    learning_points: ['The Ramayana is a living guide for all generations.', 'Dharma is a light that never fades.'],
    quiz_questions: [],
    source_notes: 'Reflective closing based on the enduring tradition of the Ramayana.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    beats: [
      { imageUrl: '/images/scene_closing_beat_1.png', visualDescription: 'A wide shot of a serene temple courtyard at twilight, with the oil lamp (diya) glowing in the center. Surrounding the lamp are silhouettes of Rama, Sita, Lakshmana, and Hanuman, all standing in reverent poses, their ornate costumes illuminated by the warm light.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_closing_beat_2.png', visualDescription: 'A close-up of Rama\'s face, his expression a mix of determination and tranquility as he gazes at the lamp. The warm glow reflects in his eyes, symbolizing the light of dharma guiding him.', motion: 'slow_zoom_in' },
      { imageUrl: '/images/scene_closing_beat_3.png', visualDescription: 'A dynamic shot of Sita extending her hand towards the lamp, her fingers gently brushing against the flame. The moment captures her deep connection to dharma and her unwavering strength.', motion: 'battle_push' },
      { imageUrl: '/images/scene_closing_beat_4.png', visualDescription: 'A close-up of Lakshmana standing resolutely, with a slight smile as he watches Sita. His hand rests on his sword, indicating readiness and loyalty, embodying the bond of brotherhood.', motion: 'fade_only' },
      { imageUrl: '/images/scene_closing_beat_5.png', visualDescription: 'A wide shot pulling back to reveal the entire temple bathed in the golden glow of the lamp, with the characters now fully enveloped in light, symbolizing the transformative power of dharma.', motion: 'slow_zoom_out' }
    ],
  }
];

export function getSceneById(sceneId: string): Scene | undefined {
  return ramayanaScenes.find(s => s.scene_id === sceneId);
}

export function getScenesByBookId(bookId: string): Scene[] {
  return ramayanaScenes.filter(s => s.book_id === bookId).sort((a, b) => a.order_index - b.order_index);
}
