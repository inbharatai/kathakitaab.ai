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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }
];

export function getSceneById(sceneId: string): Scene | undefined {
  return ramayanaScenes.find(s => s.scene_id === sceneId);
}

export function getScenesByBookId(bookId: string): Scene[] {
  return ramayanaScenes.filter(s => s.book_id === bookId).sort((a, b) => a.order_index - b.order_index);
}
