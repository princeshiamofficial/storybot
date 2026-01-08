require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const WebSocket = require('ws');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// In-memory state storage (for demonstration purposes)
const userSessions = {};

const STEPS = {
    CATEGORY: 'CATEGORY',
    TOPIC: 'TOPIC',
    LENGTH: 'LENGTH',
    SENTENCES_PER_MSG: 'SENTENCES_PER_MSG',
    SENTENCE_LENGTH: 'SENTENCE_LENGTH',
    NUM_CHILDREN: 'NUM_CHILDREN',
    CHILD_DETAILS: 'CHILD_DETAILS'
};

const OPTIONS = {
    categories: ['Fairy Tales', 'Animals', 'Fantasy', 'Science Fiction', 'Mystery', 'Adventure', 'Sports', 'School'],
    topics: ['Friendship', 'Family', 'Magic', 'Space', 'Nature', 'History', 'Heroes', 'Holidays', 'Travel'],
    lengths: [
        { label: 'Short (250 words)', value: 'short' },
        { label: 'Medium (600 words)', value: 'medium' },
        { label: 'Long (1000 words)', value: 'long' }
    ],
    sentencesPerPara: ['1', '2', '3', '4', '5'],
    sentenceLengths: ['Short', 'Medium', 'Long']
};

bot.command('start', (ctx) => {
    userSessions[ctx.from.id] = { step: STEPS.CATEGORY, data: {} };
    ctx.reply(
        'Welcome to the Story Generator! 📖\nLet\'s create a fun story. First, choose a category:',
        Markup.keyboard(OPTIONS.categories.map(c => [c])).oneTime().resize()
    );
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    const text = ctx.message.text;

    if (!session) {
        return ctx.reply('Please type /start to begin a new story.');
    }

    switch (session.step) {
        case STEPS.CATEGORY:
            if (!OPTIONS.categories.includes(text)) {
                return ctx.reply('Please select a valid category from the keyboard.');
            }
            session.data.category = text;
            session.step = STEPS.TOPIC;
            ctx.reply(
                'Great! Now select a topic:',
                Markup.keyboard(OPTIONS.topics.map(t => [t])).oneTime().resize()
            );
            break;

        case STEPS.TOPIC:
            if (!OPTIONS.topics.includes(text)) {
                return ctx.reply('Please select a valid topic.');
            }
            session.data.topic = text;
            session.step = STEPS.LENGTH;
            ctx.reply(
                'How long should the story be?',
                Markup.keyboard(OPTIONS.lengths.map(l => [l.label])).oneTime().resize()
            );
            break;

        case STEPS.LENGTH:
            const selectedLength = OPTIONS.lengths.find(l => l.label === text);
            if (!selectedLength) {
                return ctx.reply('Please select a valid length.');
            }
            session.data.storyLength = selectedLength.value;
            session.step = STEPS.SENTENCES_PER_MSG;
            ctx.reply(
                'How many sentences per paragraph?',
                Markup.keyboard(OPTIONS.sentencesPerPara.map(s => [s + ' sentence(s)'])).oneTime().resize()
            );
            break;

        case STEPS.SENTENCES_PER_MSG:
            const sentCount = text.split(' ')[0]; // Extract number
            if (!OPTIONS.sentencesPerPara.includes(sentCount)) {
                return ctx.reply('Please select a valid number.');
            }
            session.data.sentencesPerParagraph = sentCount;
            session.step = STEPS.SENTENCE_LENGTH;
            ctx.reply(
                'How long should the sentences be?',
                Markup.keyboard(OPTIONS.sentenceLengths.map(s => [s])).oneTime().resize()
            );
            break;

        case STEPS.SENTENCE_LENGTH:
            if (!OPTIONS.sentenceLengths.includes(text)) {
                return ctx.reply('Please select a valid option.');
            }
            session.data.sentenceLength = text.toLowerCase();
            session.step = STEPS.NUM_CHILDREN;
            ctx.reply('How many children are in the story? (Enter a number between 1 and 10)', Markup.removeKeyboard());
            break;

        case STEPS.NUM_CHILDREN:
            const num = parseInt(text);
            if (isNaN(num) || num < 1 || num > 10) {
                return ctx.reply('Please enter a valid number between 1 and 10.');
            }
            session.data.expectedChildren = num;
            session.data.children = [];
            session.step = STEPS.CHILD_DETAILS;
            ctx.reply(`Please enter details for Child 1 in this format:\nName, Age, Gender, Hair Color, Eye Color, Skin Tone\n\nExample: Raia, 3, female, black, gray, brown`);
            break;

        case STEPS.CHILD_DETAILS:
            const childIndex = session.data.children.length + 1;
            const parts = text.split(',').map(s => s.trim());

            if (parts.length < 6) {
                return ctx.reply(`Please provide all 6 details separated by commas:\nName, Age, Gender, Hair Color, Eye Color, Skin Tone`);
            }

            session.data.children.push({
                name: parts[0],
                age: parts[1],
                gender: parts[2],
                hairColor: parts[3],
                eyeColor: parts[4],
                skinTone: parts[5]
            });

            if (session.data.children.length < session.data.expectedChildren) {
                ctx.reply(`Saved! Now enter details for Child ${session.data.children.length + 1}:`);
            } else {
                // All inputs gathered, generate story
                await generateStory(ctx, session.data);
                delete userSessions[userId]; // Reset session
            }
            break;
    }
});

async function generateStory(ctx, data) {
    await ctx.reply('🌟 Generating your story... This might take a moment.');

    const childDataString = data.children.map(c =>
        `${c.name} (${c.age} years old, ${c.gender}, Hair: ${c.hairColor}, Eyes: ${c.eyeColor}, Skin: ${c.skinTone})`
    ).join(', ');

    const prompt = `Create a ${data.storyLength} personalised ${data.category} story about ${data.topic}, including the following children: ${childDataString}. Story must have ${data.sentencesPerParagraph} sentences per paragraph and make the sentences ${data.sentenceLength}. Only show me the Title of the story and the Story. Respond in HTML using <p> for paragraphs.`;

    const generatedTextPromise = new Promise((resolve, reject) => {
        let fullText = '';
        const ws = new WebSocket(`wss://backend.buildpicoapps.com/ask_ai_streaming?app_id=everybody-once&prompt=${encodeURIComponent(prompt)}`);

        ws.on('message', (data) => {
            fullText += data.toString();
        });

        ws.on('close', (code) => {
            if (code === 1000) resolve(fullText);
            else reject(new Error('WebSocket closed with error'));
        });

        ws.on('error', (err) => reject(err));
    });

    try {
        const fullHtml = await generatedTextPromise;

        // Extract Title (Assuming it's in <h1> or first line)
        // The API returns HTML, we often get <h1>Title</h1><p>...</p>
        // Let's strip simple HTML tags for Telegram text or keep them formatted.
        // Telegram supports robust HTML but let's be careful with what the AI sends.

        // Simple regex to find title and body - AI usually sends <h1>Title</h1>
        const titleMatch = fullHtml.match(/<h1>(.*?)<\/h1>/);
        const title = titleMatch ? titleMatch[1] : 'A Wonderful Story';

        // Convert <p> to newlines for text message
        let cleanStory = fullHtml.replace(/<h1>.*?<\/h1>/, '')
            .replace(/<p>/g, '')
            .replace(/<\/p>/g, '\n\n')
            .replace(/<br\s*\/?>/g, '\n');

        // Generate Image
        const titlePrompt = `Create a cute and heartwarming illustration image for the story titled: ${title}. For these characters: ${childDataString},`;

        await ctx.reply('🎨 Painting a picture for your story...');

        const imageResp = await axios.post("https://backend.buildpicoapps.com/aero/run/image-generation-api?pk=v1-Z0FBQUFBQnBYMDEtM2VMU1Z1UDZsYnZKUDhUaVpKdzV0Ty1IeGJOWWx1bFJmZmR6YkExQmRSaHN2OHhtVnhUMVhTRmVmVy10blczOE1DWHpWajVWcjd2NkJJaVp3MEZ3elE9PQ==", {
            prompt: titlePrompt
        });

        if (imageResp.data.status === 'success') {
            await ctx.replyWithPhoto(imageResp.data.imageUrl, {
                caption: `<b>${title}</b>`,
                parse_mode: 'HTML'
            });
        } else {
            await ctx.reply(`<b>${title}</b>`, { parse_mode: 'HTML' });
        }

        // Send full text
        const chunks = cleanStory.match(/.{1,4000}/g) || [];
        for (const chunk of chunks) {
            await ctx.reply(chunk);
        }

    } catch (error) {
        console.error('Error:', error);
        ctx.reply('Sorry, something went wrong while generating the story. Please try again.');
    }
}

bot.launch().then(() => {
    console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
