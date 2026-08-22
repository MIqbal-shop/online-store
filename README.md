# Online Store - Deploy Karne Ka Tareeqa (Bilkul Free)

Yeh website 2 free services use karti hai:
1. **Supabase** - database (products + orders yahan save hote hain)
2. **Render** - website ko internet pe 24/7 chalane ke liye

Dono free hain, koi card nahi maangte.

---

## Step 1: Supabase Par Free Database Banayein

1. https://supabase.com par jayein, **"Start your project"** par click karein, apna email/Google se account banayein.
2. **"New Project"** par click karein.
   - Naam kuch bhi de dein (jaise `online-store`)
   - Database Password: ek strong password bana kar **kahin likh lein** (yeh baad mein nahi milega)
   - Region: apne se qareeb wala select karein (jaise Singapore)
3. Project ban jaye (1-2 minute lagte hain), phir left menu se **"Project Settings"** (gear icon) → **"Database"** par jayein.
4. **"Connection string"** section mein, **"Connection pooling"** wala tab select karein, aur **URI** copy kar lein.
   - Yeh kuch aisa dikhega: `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-xxxx.pooler.supabase.com:6543/postgres`
   - `[YOUR-PASSWORD]` ki jagah apna wo password likh dein jo Step 2 mein banaya tha.
5. Yeh poora link (password ke sath) safe jagah save kar lein - isko **DATABASE_URL** kehte hain, agle step mein chahiye hoga.

---

## Step 2: Code GitHub Par Daalein

Render seedha GitHub se deploy karta hai, isliye pehle yeh code GitHub par daalna hoga.

1. https://github.com par account banayein (agar nahi hai).
2. Naya repository banayein (jaise `online-store`), **Public** ya **Private** koi bhi.
3. Yeh poora `online-store` folder us repository mein upload kar dein (GitHub website se "uploading an existing file" wala option use kar sakte hain, ya `git` command se).

---

## Step 3: Render Par Deploy Karein

1. https://render.com par jayein, GitHub se sign up karein.
2. **"New +"** → **"Web Service"** par click karein.
3. Apni GitHub repository (jo Step 2 mein banayi) select karein.
4. Settings yeh rakhein:
   - **Name:** kuch bhi (jaise `mera-online-store`) - yehi aapki website ka link banega: `mera-online-store.onrender.com`
   - **Region:** koi bhi
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Neeche **"Environment Variables"** section mein ek variable add karein:
   - Key: `DATABASE_URL`
   - Value: wo poora Supabase connection string jo Step 1 mein save kiya tha
6. **"Create Web Service"** par click karein. 2-3 minute mein deploy ho jayega.
7. Deploy hone ke baad upar ek link milega jaisay `https://mera-online-store.onrender.com` - yehi aapki live website hai!

---

## Step 4: Apna Admin Account Banayein

1. Apni website ke link ke aakhir mein `/admin.html` lagayein, jaise:
   `https://mera-online-store.onrender.com/admin.html`
2. Pehli baar khulne par **"Admin Account Banayein"** form aayega - apna username aur password set kar lein.
3. Login ho kar **"Products"** tab se apne products add karein (naam, rate, tasveer).
4. **"DMS Connection"** tab par jayein - yahan aapko **Website ka Link** aur **Secret Key** dikhegi.

---

## Step 5: DMS Ko Website Se Jorein

1. Apne DMS mein **Settings** page kholein, **"🌐 Online Store"** section dhoondein.
2. Wahan wahi **Website ka Link** aur **Secret Key** paste kar dein (jo Step 4 mein dekhi thi).
3. **Save** karein.

Bas ho gaya! Ab jab bhi koi customer website se order karega, wo order 15-20 second ke andar aapke DMS ke **"Online Orders"** page mein khud aa jayega.

---

## Zaroori Baatein

- **Free service "so" jaati hai** agar 15 minute tak koi visit na kare - agla customer aane par 30-60 second lagenge khulne mein (bas ek dafa). Baaki hamesha normal speed.
- Agar kabhi order zyada ho jayen aur ye rukawat pareshan kare, to Render ka **paid plan** ($7/month) yeh masla khatam kar deta hai - lekin abhi zaroorat nahi.
- Apna website ka naam/tagline badalne ke liye `public/config.js` file kholein, sirf 2 lines edit karni hain.
- Agar kabhi Secret Key leak ho jaye ya change karni ho, Admin Panel ke "DMS Connection" tab se "Nayi Key Banayein" dabayein - phir wahi nayi key DMS Settings mein bhi update kar dein.
