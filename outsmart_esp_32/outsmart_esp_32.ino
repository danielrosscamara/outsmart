#if defined(ESP32) || defined(ARDUINO_RASPBERRY_PI_PICO_W)
#include <WiFi.h>
#elif defined(ESP8266)
#include <ESP8266WiFi.h>
#elif __has_include(<WiFiNINA.h>)
#include <WiFiNINA.h>
#elif __has_include(<WiFi101.h>)
#include <WiFi101.h>
#elif __has_include(<WiFiS3.h>)
#include <WiFiS3.h>
#endif
#include <Firebase_ESP_Client.h>
#include <PZEM004Tv30.h>
#include <SoftwareSerial.h>

#if !defined(PZEM_RX_PIN) && !defined(PZEM_TX_PIN)
#define PZEM_RX_PIN 13 //13 dati
#define PZEM_TX_PIN 12 //12 dati
#endif


SoftwareSerial pzemSWSerial(PZEM_RX_PIN, PZEM_TX_PIN);
PZEM004Tv30 pzem(pzemSWSerial);

/* 1. Define the WiFi credentials */
#define WIFI_SSID "(^_^)_Guest"
#define WIFI_PASSWORD "1234asdf"

/* 2. Define the API Key */
#define API_KEY "AIzaSyDtG6AiTwmJSRI3utIEexF3dmXwH1RqOPw"

/* 3. Define the user Email and password */
#define USER_EMAIL "xdzak68@gmail.com"
#define USER_PASSWORD "asdf1234"

/* 4. Define the RTDB URL */
#define DATABASE_URL "https://outsmart-f1174-default-rtdb.asia-southeast1.firebasedatabase.app/" 

/* 5. Define the Target Path in your Database */
#define FIREBASE_PATH "/Outlets/outlet1"

#define RELAY_PIN 4

String relayState = "HIGH"; // Default state

unsigned long lastSendLatency = 0; // <-- ADD THIS LINE
unsigned long lastReadLatency = 0; // <-- ADD THIS LINE

// Define Firebase Data object
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long sendDataPrevMillis = 0;

void setup()
{
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Set default relay state on boot
pinMode(LED_BUILTIN, OUTPUT); 

  Serial.begin(9600);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED)
  {
    Serial.print(".");
    delay(300);
  }
  Serial.println();
  Serial.print("Connected with IP: ");
  Serial.println(WiFi.localIP());
  Serial.println();
  digitalWrite(LED_BUILTIN, HIGH);
  /* Assign the api key (required) */
  config.api_key = API_KEY;

  /* Assign the user sign in credentials */
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;

  /* Assign the RTDB URL (required) */
  config.database_url = DATABASE_URL;

  Firebase.reconnectNetwork(true);

  fbdo.setBSSLBufferSize(4096, 1024);
  fbdo.setResponseSize(2048);

  Firebase.begin(&config, &auth);
  Firebase.setDoubleDigits(5);
  config.timeout.serverResponse = 10 * 1000;
}

void loop()
{
    // Check if Firebase is ready and if it's time to send data (every 1 second)
    if (Firebase.ready() && (millis() - sendDataPrevMillis > 1000 || sendDataPrevMillis == 0))
    {
        sendDataPrevMillis = millis();

        float voltage = pzem.voltage();
        float current = pzem.current();
        float power = pzem.power(); 
        float energy = pzem.energy();
        float frequency = pzem.frequency();
        float pf = pzem.pf();

        if (isnan(voltage) || isnan(current) || isnan(power) || isnan(energy) || isnan(frequency) || isnan(pf))
        {
            Serial.println("Error reading from PZEM sensor. Skipping Firebase update.");
        }
        else 
        {
            // --- BUNDLE ALL DATA INTO A SINGLE JSON OBJECT ---
            FirebaseJson json;
            json.set("voltage", voltage);
            json.set("current", current);
            json.set("watts", power);
            json.set("energy", energy);
            json.set("frequency", frequency);
            json.set("powerfactor", pf);
            // Add the server-side timestamp
            json.set("lastUpdatedTimestamp/.sv", "timestamp");
            // Include the latency values from the PREVIOUS cycle
            json.set("sendLatencyMs", lastSendLatency);
            json.set("readLatencyMs", lastReadLatency);

            // --- SEND THE ENTIRE JSON OBJECT AND MEASURE LATENCY FOR NEXT TIME ---
            Serial.println("Sending bundled JSON data to Firebase...");
            unsigned long sendStartTime = millis();
            bool sendSuccess = Firebase.RTDB.updateNode(&fbdo, FIREBASE_PATH, &json);
            lastSendLatency = millis() - sendStartTime; // Store latency for the next loop

            if (sendSuccess)
            {
                Serial.print("JSON data sent successfully. Latency for this send: ");
                Serial.println(lastSendLatency); // <-- FIXED: Print the variable directly
            }
            else
            {
                Serial.println("Failed to send JSON data: " + fbdo.errorReason());
            }

            // --- READ THE RELAY STATUS AND MEASURE LATENCY FOR NEXT TIME ---
            unsigned long readStartTime = millis();
            bool readSuccess = Firebase.RTDB.getString(&fbdo, String(FIREBASE_PATH) + "/status");
            lastReadLatency = millis() - readStartTime; // Store latency for the next loop
            
            if (readSuccess)
            {
                relayState = fbdo.to<const char *>();
                if(relayState.equalsIgnoreCase("HIGH")) {
                    digitalWrite(RELAY_PIN, HIGH);
                } else {
                    digitalWrite(RELAY_PIN, LOW);
                }
                Serial.print("Relay status read successfully. Latency for this read: ");
                Serial.println(lastReadLatency); // <-- FIXED: Print the variable directly
            }
            else
            {
                Serial.println("Failed to get relay status: " + fbdo.errorReason());
            }
        }
    }
    delay(500);    
}