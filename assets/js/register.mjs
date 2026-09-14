// --- YOUR FIREBASE IMPORTS AND CONFIG ---
        import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
        import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
        import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

        const firebaseConfig = {
            apiKey: "AIzaSyDyUT23tUg7E1wQh5J1msxDzShGSceAAJ4",
            authDomain: "outsmart-f1174.firebaseapp.com",
            databaseURL: "https://outsmart-f1174-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "outsmart-f1174",
            storageBucket: "outsmart-f1174.firebasestorage.app",
            messagingSenderId: "679675760568",
            appId: "1:679675760568:web:ec3a6e0e8487f01efd094d",
            measurementId: "G-S2RMK4NWV1"
        };

        // --- INITIALIZATION ---
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getDatabase(app);
        
        // --- DOM ELEMENTS ---
        const registerForm = document.getElementById('register-form');
        const usernameInput = document.getElementById('username');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const messageEl = document.getElementById('message');

        // --- REGISTER EVENT LISTENER ---
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent the form from reloading the page

            const username = usernameInput.value.trim();
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();
            
            // Clear previous messages
            messageEl.textContent = '';
            messageEl.className = '';

            try {
                // 1. Create user with email and password in Firebase Auth
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                console.log("User created in Auth:", user);

                // 2. Save additional user info (like username) to Realtime Database
                await set(ref(db, 'users/' + user.uid), {
                    username: username,
                    email: email,
                    createdAt: new Date().toISOString() // Good practice to store creation date
                });
                
                console.log("User data saved to Realtime Database");

                // 3. Provide success feedback to the user
                messageEl.textContent = 'Registration successful! You can now log in.';
                messageEl.classList.add('success');
                registerForm.reset(); // Clear the form fields

            } catch (error) {
                // 4. Handle errors and provide feedback
                console.error("Registration Error:", error);
                // Provide a user-friendly error message
                messageEl.textContent = `Error: ${error.message}`;
                messageEl.classList.add('error');
            }
        });