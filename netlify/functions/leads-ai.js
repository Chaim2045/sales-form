// Netlify Function: Lead AI Scoring with Claude
// Analyzes leads and returns score, category, suggested assignee, urgency

const https = require('https');

function httpRequest(options, data) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, data: body }); }
            });
        });
        req.on('error', reject);
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

async function verifyAuth(idToken) {
    var apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY;
    if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY not configured');

    var postData = JSON.stringify({ idToken: idToken });
    var res = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        path: '/v1/accounts:lookup?key=' + apiKey,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);

    if (res.status !== 200 || !res.data.users || !res.data.users[0]) {
        throw new Error('Invalid token');
    }
    return res.data.users[0].localId;
}

const SYSTEM_PROMPT = `אתה מנהל מכירות AI של משרד עו"ד גיא הרשקוביץ ושות'. התפקיד שלך: לנתח כל ליד, לתת ציון, ולהכין את איש המכירות לשיחה מושלמת.

## תחומי המשרד (מטפלים ישירות):
מסחרי, מקרקעין, דיני עבודה, שותפויות, חברות, קניין רוחני.

## תחומים להפניה חיצונית (עמלת הפניה — עדיין שווה כסף!):
פלילי, נזיקין, משפחה, ירושות.

## מחירון המשרד:
- פגישת ייעוץ ראשונה: 780₪ + מע"מ
- ריטיינר חודשי: 3,000-15,000₪
- תוכנית שעות: לפי שעות עבודה
- תיק משפטי גדול: 45,000-60,000₪ ממוצע
- הפניה חיצונית (פלילי/נזיקין): עמלת הפניה 10-20%

## החזר JSON בלבד:
{
  "score": <1-10>,
  "reason": "<הסבר קצר — למה הניקוד הזה, 1-2 משפטים>",
  "category": "<דיני עבודה|מקרקעין|מסחרי|שותפויות|חברות|קניין רוחני|פלילי|נזיקין|אחר>",
  "suggestedAssignee": "<שם עובד מומלץ>",
  "urgency": "<high|medium|low>",
  "action": "<המלצת פעולה ספציפית — מה לעשות, מתי, למה>",
  "callPrep": "<הכנה לשיחה: 2-3 שאלות מפתח לשאול את הלקוח + נקודות חשובות>",
  "estimatedValue": "<הערכת שווי העסקה: 'ייעוץ 780₪' / 'ריטיינר 5-10K' / 'תיק 45-60K' / 'הפניה'>",
  "legalContext": "<הקשר משפטי קצר: חוקים/פסיקה רלוונטית שיעזרו בשיחה>"
}

## כללי ניקוד:
- 9-10: תיק גדול פוטנציאלי (45K+), נושא ברור, לקוח מוכן ודחוף
- 7-8: נושא ברור, פוטנציאל כלכלי טוב (ריטיינר/תיק), לקוח רציני
- 5-6: רלוונטי אבל לא ברור עדיין — צריך שיחת בירור. פוטנציאל לייעוץ 780₪ לפחות
- 3-4: סיכוי נמוך — לקוח לא בשל, נושא קטן, או לא ברור
- 1-2: ספאם, לא רלוונטי, או בלי מספיק מידע

## שיוך מומלץ:
- מקרקעין / קניין / פינוי בינוי / עמידר / שכירות → מירי טל
- דיני עבודה → חיים או אופק דובין
- מסחרי / חוזים / תביעות / בוררות → אופק דובין
- שותפויות / חברות / הקמת עסק → רועי הרשקוביץ או אופק דובין
- פלילי / נזיקין → הפניה חיצונית (שיוך: חיים — לתאם הפניה)
- לא ברור → חיים (מכירות כללי, בירור ראשוני)

## כללים חשובים:
- גם אם הנושא לא בתחום המשרד (פלילי/נזיקין) — זה עדיין ליד! ניתן להפנות ולקבל עמלה. תן ציון 4-5 ותכתוב "הפניה חיצונית".
- "שיחה שלא נענתה" = ליד חם (7+). הלקוח התקשר = מעוניין.
- אם יש רמז לסכום ("חוזה של מיליון", "דירה") → העלה ניקוד.
- אם הלקוח כותב "דחוף" / "פוטרתי" / "מחר דיון" → urgency: high.
- בהכנה לשיחה (callPrep) — תן שאלות ספציפיות, לא גנריות. "מתי קרה?" "יש תיעוד?" "מה הסכום?"
- בהקשר משפטי (legalContext) — ציין חוק או עיקרון רלוונטי בקצרה.`;

exports.handler = async (event) => {
    var corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        var authHeader = event.headers.authorization || event.headers.Authorization || '';
        var idToken = authHeader.replace('Bearer ', '');
        if (!idToken) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Missing auth token' }) };
        }
        await verifyAuth(idToken);

        var body = JSON.parse(event.body);
        var lead = body.lead;
        if (!lead) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing lead data' }) };
        }

        var anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicKey) {
            return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
        }

        var userMessage = 'נתח את הליד הבא:\n\n' +
            'שם: ' + (lead.name || 'לא ידוע') + '\n' +
            'טלפון: ' + (lead.phone || 'לא ידוע') + '\n' +
            'נושא: ' + (lead.subject || 'לא ידוע') + '\n' +
            'מקור: ' + (lead.source || 'לא ידוע') + '\n' +
            (lead.originalMessage ? 'הודעה מקורית: "' + lead.originalMessage.substring(0, 500) + '"' : '');

        var requestBody = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }]
        });

        var res = await httpRequest({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        }, requestBody);

        if (res.status !== 200) {
            console.error('Claude API error:', res.status);
            return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Claude API error' }) };
        }

        var responseText = res.data.content[0].text.trim();
        var jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid AI response' }) };
        }

        var result = JSON.parse(jsonMatch[0]);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                score: result.score || 5,
                reason: result.reason || '',
                category: result.category || 'אחר',
                suggestedAssignee: result.suggestedAssignee || '',
                urgency: result.urgency || 'medium',
                action: result.action || '',
                callPrep: result.callPrep || '',
                estimatedValue: result.estimatedValue || '',
                legalContext: result.legalContext || ''
            })
        };

    } catch (err) {
        console.error('Leads AI error:', err);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
};
