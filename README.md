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

## Step 3: Vercel Par Deploy Karein (Bilkul Free, Koi Card Nahi)

1. https://vercel.com par jayein, **"Sign Up"** dabayein, **"Continue with GitHub"** select karein (koi card nahi maangta).
2. Login hone ke baad **"Add New..."** → **"Project"** par click karein.
3. Apni `online-store` repository dhoondein aur **"Import"** dabayein.
4. Settings automatically theek honge (Framework: "Other") - kuch badalne ki zaroorat nahi.
5. **"Environment Variables"** section mein ek variable add karein:
   - Key: `DATABASE_URL`
   - Value: wo poora Supabase connection string (Step 1 wala)
6. **"Deploy"** button dabayein. 1-2 minute mein deploy ho jayega.
7. Deploy hone ke baad ek link milega jaisay `https://online-store-xyz.vercel.app` - yehi aapki live website hai!

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

- **Free service "so" nahi jaati** Vercel par jis tarah Render mein hoti thi - lekin pehli baar (ya lambi khamoshi ke baad) khulne mein 1-2 second lag sakte hain, ye normal hai.
- Apna website ka naam/tagline badalne ke liye `public/config.js` file kholein, sirf 2 lines edit karni hain.
- Agar kabhi Secret Key leak ho jaye ya change karni ho, Admin Panel ke "DMS Connection" tab se "Nayi Key Banayein" dabayein - phir wahi nayi key DMS Settings mein bhi update kar dein.
