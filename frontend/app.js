/**
 * Pulse Connect — API-ready frontend
 * Donor records are fetched from the future backend. The browser keeps only
 * a temporary in-memory copy for rendering and an IndexedDB cache for offline
 * emergency lookup. MySQL remains the permanent source of truth.
 */

// Backend contract: implement these routes when the backend is created.
const API_CONFIG = {
  BASE_URL: "http://127.0.0.1:3000/api",
  ENDPOINTS: {
    DONORS: "/donors",
    REGISTER_DONOR: "/donors",
    EMERGENCY_REQUESTS: "/emergency-requests"
  },
  REQUEST_TIMEOUT_MS: 10000
};

// IndexedDB is only an offline read cache, not the main database.
const OFFLINE_CACHE_CONFIG = {
  ENABLED: true,
  DATABASE_NAME: "PulseConnectOffline",
  DATABASE_VERSION: 1,
  STORE_NAME: "donors"
};

class ApiService {
  static async request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_CONFIG.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        cache: "no-store",
        signal: controller.signal
      });

      const body = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || `Server error (${response.status})`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  static getDonors() {
    return this.request(API_CONFIG.ENDPOINTS.DONORS);
  }

  static registerDonor(donor) {
    return this.request(API_CONFIG.ENDPOINTS.REGISTER_DONOR, {
      method: "POST",
      body: JSON.stringify(donor)
    });
  }

  static updateDonor(id, changes) {
    return this.request(`${API_CONFIG.ENDPOINTS.DONORS}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
  }

  static deleteDonor(id) {
    return this.request(`${API_CONFIG.ENDPOINTS.DONORS}/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  static submitEmergencyRequest(request) {
    return this.request(API_CONFIG.ENDPOINTS.EMERGENCY_REQUESTS, {
      method: "POST",
      body: JSON.stringify(request)
    });
  }
}

class OfflineDonorCache {
  static open() {
    if (!OFFLINE_CACHE_CONFIG.ENABLED || !("indexedDB" in window)) {
      return Promise.reject(new Error("Offline cache is unavailable in this browser."));
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        OFFLINE_CACHE_CONFIG.DATABASE_NAME,
        OFFLINE_CACHE_CONFIG.DATABASE_VERSION
      );
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OFFLINE_CACHE_CONFIG.STORE_NAME)) {
          db.createObjectStore(OFFLINE_CACHE_CONFIG.STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async saveDonors(donors) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_CACHE_CONFIG.STORE_NAME, "readwrite");
      const store = tx.objectStore(OFFLINE_CACHE_CONFIG.STORE_NAME);
      store.clear();
      donors.forEach(donor => store.put(donor));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  static async getDonors() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_CACHE_CONFIG.STORE_NAME, "readonly");
      const request = tx.objectStore(OFFLINE_CACHE_CONFIG.STORE_NAME).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result || []); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
}

// Blood Transfusion Compatibility Map (Recipient -> Compatible Donors)
const BLOOD_COMPATIBILITY = {
  "A+": ["A+", "A-", "O+", "O-"],
  "A-": ["A-", "O-"],
  "B+": ["B+", "B-", "O+", "O-"],
  "B-": ["B-", "O-"],
  "AB+": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"], // Universal recipient
  "AB-": ["AB-", "A-", "B-", "O-"],
  "O+": ["O+", "O-"],
  "O-": ["O-"] // Universal donor
};

// ============================================================================
// 2. External Location API Service (Open-Meteo Geocoding / Nominatim fallback)
// ============================================================================
class LocationService {
  /**
   * Search for locations matching query using external API
   */
  static async searchLocations(query) {
    if (!query || query.trim().length < 2) return [];

    const cleanQuery = query.trim();
    try {
      // 1. Primary: Open-Meteo Geocoding API (Fast, free, CORS-enabled, reliable)
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanQuery)}&count=5&language=en&format=json`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data && data.results && data.results.length > 0) {
          return data.results.map(item => ({
            name: item.name,
            state: item.admin1 || "",
            country: item.country || "India",
            formatted: [item.name, item.admin1, item.country].filter(Boolean).join(", ")
          }));
        }
      }
    } catch {
      // Fallback below
    }

    // 2. Fallback: OpenStreetMap Nominatim API
    try {
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=5&addressdetails=1`;
      const response = await fetch(nominatimUrl);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map(item => {
            const addr = item.address || {};
            const cityName = addr.city || addr.town || addr.village || addr.county || item.name;
            const state = addr.state || "";
            const country = addr.country || "India";
            return {
              name: cityName,
              state: state,
              country: country,
              formatted: [cityName, state, country].filter(Boolean).join(", ")
            };
          });
        }
      }
    } catch {
      // Fallback to local Indian cities list if offline
    }

    // Fallback: Local known cities list for offline tolerance
    const localCities = [
      { name: "Chennai", state: "Tamil Nadu", country: "India" },
      { name: "Mumbai", state: "Maharashtra", country: "India" },
      { name: "Delhi", state: "Delhi", country: "India" },
      { name: "Bengaluru", state: "Karnataka", country: "India" },
      { name: "Pune", state: "Maharashtra", country: "India" },
      { name: "Kolkata", state: "West Bengal", country: "India" },
      { name: "Hyderabad", state: "Telangana", country: "India" },
      { name: "Ahmedabad", state: "Gujarat", country: "India" },
      { name: "Kochi", state: "Kerala", country: "India" },
      { name: "Jaipur", state: "Rajasthan", country: "India" }
    ];

    return localCities
      .filter(c => c.name.toLowerCase().includes(cleanQuery.toLowerCase()))
      .map(c => ({
        ...c,
        formatted: `${c.name}, ${c.state}, ${c.country}`
      }));
  }

  /**
   * Verify if a user-entered location exists in external API
   */
  static async verifyLocation(locationString) {
    if (!locationString || locationString.trim().length < 2) return { valid: false };
    const results = await this.searchLocations(locationString);
    if (results && results.length > 0) {
      return { valid: true, standardized: results[0].formatted };
    }
    return { valid: false };
  }
}

// ============================================================================
// 3. Main Application Class
// ============================================================================
class PulseConnectApp {
  constructor() {
    // Runtime copy only. Permanent records live in the backend database.
    this.donors = [];
    this.isOfflineData = false;
    this.isLocationVerified = false;
    this.locationDebounceTimers = {};

    this.cacheDom();
    this.bindEvents();
    this.headerDonorsCount.textContent = "Loading donor records...";
    this.initialize();
  }

  async initialize() {
    try {
      await this.refreshDonors();
    } catch (error) {
      console.error("Could not load donor records:", error);
      this.showToast("Could not connect to the donor database. Trying offline records...", "default");
    }
    this.updateHeaderCount();
  }

  normalizeDonorResponse(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.donors)) return payload.donors;
    return [];
  }

  async refreshDonors() {
    try {
      const payload = await ApiService.getDonors();
      this.donors = this.normalizeDonorResponse(payload);
      this.isOfflineData = false;
      try {
        await OfflineDonorCache.saveDonors(this.donors);
      } catch (cacheError) {
        console.warn("Donors loaded, but offline cache could not be updated:", cacheError);
      }
    } catch (error) {
      // On network/server failure, use the last successfully synced local copy.
      try {
        const cachedDonors = await OfflineDonorCache.getDonors();
        if (cachedDonors.length) {
          this.donors = cachedDonors;
          this.isOfflineData = true;
          this.updateHeaderCount();
          if (this.hasActiveFilters()) this.handleFilterChange();
          return this.donors;
        }
      } catch (cacheError) {
        console.warn("Offline donor cache unavailable:", cacheError);
      }
      this.donors = [];
      this.isOfflineData = !navigator.onLine;
      throw error;
    }

    this.updateHeaderCount();
    if (this.hasActiveFilters()) this.handleFilterChange();
    return this.donors;
  }

  hasActiveFilters() {
    return Boolean(      this.searchInput.value.trim() || this.bloodGroupFilter.value ||
      this.locationFilter.value.trim() || this.statusFilter.value
    );
  }

  cacheDom() {
    // Header elements
    this.headerDonorsCount = document.getElementById("headerDonorsCount");
    this.headerRegisterBtn = document.getElementById("headerRegisterBtn");
    this.headerEmergencyBtn = document.getElementById("headerEmergencyBtn");

    // Filter elements
    this.searchInput = document.getElementById("searchInput");
    this.bloodGroupFilter = document.getElementById("bloodGroupFilter");
    this.locationFilter = document.getElementById("locationFilter");
    this.locationFilterSpinner = document.getElementById("locationFilterSpinner");
    this.locationFilterDropdown = document.getElementById("locationFilterDropdown");
    this.statusFilter = document.getElementById("statusFilter");
    this.filterStatusText = document.getElementById("filterStatusText");
    this.resetFiltersBtn = document.getElementById("resetFiltersBtn");

    // Results elements
    this.noSearchPlaceholder = document.getElementById("noSearchPlaceholder");
    this.donorsGrid = document.getElementById("donorsGrid");
    this.emptySearchState = document.getElementById("emptySearchState");

    // Inline Registration Form
    this.registerSection = document.getElementById("registerSection");
    this.inlineRegisterForm = document.getElementById("inlineRegisterForm");
    this.regFullName = document.getElementById("regFullName");
    this.regBloodGroup = document.getElementById("regBloodGroup");
    this.regAge = document.getElementById("regAge");
    this.regLocation = document.getElementById("regLocation");
    this.regLocationSpinner = document.getElementById("regLocationSpinner");
    this.regLocationDropdown = document.getElementById("regLocationDropdown");
    this.regVerifyStatusBadge = document.getElementById("regVerifyStatusBadge");
    this.regPhone = document.getElementById("regPhone");
    this.regAvailableCheckbox = document.getElementById("regAvailableCheckbox");

    // Emergency Modal elements
    this.emergencyModal = document.getElementById("emergencyModal");
    this.closeEmergencyModal = document.getElementById("closeEmergencyModal");
    this.cancelEmergencyModal = document.getElementById("cancelEmergencyModal");
    this.emergencyModalForm = document.getElementById("emergencyModalForm");
    this.emPatientName = document.getElementById("emPatientName");
    this.emBloodGroup = document.getElementById("emBloodGroup");
    this.emUnits = document.getElementById("emUnits");
    this.emHospital = document.getElementById("emHospital");
    this.emCity = document.getElementById("emCity");
    this.emCityDropdown = document.getElementById("emCityDropdown");
    this.emUrgency = document.getElementById("emUrgency");
    this.emContactPhone = document.getElementById("emContactPhone");
    this.compatMatchesBadge = document.getElementById("compatMatchesBadge");
    this.compatDetailsText = document.getElementById("compatDetailsText");

    // Toast Container
    this.toastStack = document.getElementById("toastStack");
  }

  bindEvents() {
    // 1. Search & Filter Input Listeners
    const triggerFilter = () => this.handleFilterChange();
    this.searchInput.addEventListener("input", triggerFilter);
    this.bloodGroupFilter.addEventListener("change", triggerFilter);
    this.statusFilter.addEventListener("change", triggerFilter);
    this.resetFiltersBtn.addEventListener("click", () => this.resetFilters());

    // 2. Location Filter Autocomplete (External API)
    this.setupAutocomplete({
      input: this.locationFilter,
      dropdown: this.locationFilterDropdown,
      spinner: this.locationFilterSpinner,
      onSelect: (item) => {
        this.locationFilter.value = item.name;
        this.handleFilterChange();
      }
    });

    // 3. Header Register Donor button -> smooth scrolls to registration card
    this.headerRegisterBtn.addEventListener("click", () => {
      this.registerSection.scrollIntoView({ behavior: "smooth", block: "center" });
      this.regFullName.focus();
    });

    // 4. Registration Location Autocomplete & Verification (External API)
    this.setupAutocomplete({
      input: this.regLocation,
      dropdown: this.regLocationDropdown,
      spinner: this.regLocationSpinner,
      onSelect: (item) => {
        this.regLocation.value = item.formatted;
        this.markLocationVerified(true, item.formatted);
      }
    });

    this.regLocation.addEventListener("input", () => {
      this.markLocationVerified(false);
    });

    // 5. Submit Registration
    this.inlineRegisterForm.addEventListener("submit", (e) => this.handleRegistration(e));

    // 6. Emergency Modal Handlers
    this.headerEmergencyBtn.addEventListener("click", () => this.openEmergencyModal());
    this.closeEmergencyModal.addEventListener("click", () => this.closeEmergencyModalHandler());
    this.cancelEmergencyModal.addEventListener("click", () => this.closeEmergencyModalHandler());
    this.emergencyModalForm.addEventListener("submit", (e) => this.handleEmergencySubmit(e));
    this.emBloodGroup.addEventListener("change", () => this.updateCompatibilityPreview());
    this.emCity.addEventListener("input", () => this.updateCompatibilityPreview());

    // Autocomplete for emergency city
    this.setupAutocomplete({
      input: this.emCity,
      dropdown: this.emCityDropdown,
      onSelect: (item) => {
        this.emCity.value = item.name;
        this.updateCompatibilityPreview();
      }
    });

    // Close modal on outside click or Escape
    window.addEventListener("click", (e) => {
      if (e.target === this.emergencyModal) this.closeEmergencyModalHandler();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeEmergencyModalHandler();
    });

    // Close autocomplete dropdowns on document click
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".autocomplete-wrapper")) {
        this.locationFilterDropdown.style.display = "none";
        this.regLocationDropdown.style.display = "none";
        this.emCityDropdown.style.display = "none";
      }
    });

    // Refresh records automatically after connectivity returns.
    window.addEventListener("online", () => {
      this.refreshDonors().then(() => {
        this.showToast("Connection restored. Donor records refreshed.", "success");
        this.updateCompatibilityPreview();
      }).catch(() => {});
    });
  }

  // ============================================================================
  // Autocomplete Setup with External Location API
  // ============================================================================
  setupAutocomplete({ input, dropdown, spinner, onSelect }) {
    let timer = null;

    input.addEventListener("input", () => {
      const query = input.value.trim();
      clearTimeout(timer);

      if (query.length < 2) {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        if (spinner) spinner.style.display = "none";
        return;
      }

      if (spinner) spinner.style.display = "inline-block";

      timer = setTimeout(async () => {
        const locations = await LocationService.searchLocations(query);
        if (spinner) spinner.style.display = "none";

        if (locations.length === 0) {
          dropdown.innerHTML = `<li class="dropdown-item dropdown-empty">No locations found via API</li>`;
          dropdown.style.display = "block";
          return;
        }

        dropdown.innerHTML = locations.map(loc => `
          <li class="dropdown-item" data-val="${encodeURIComponent(JSON.stringify(loc))}">
            <span class="item-icon">📍</span>
            <div class="item-info">
              <div class="item-title">${this.escapeHtml(loc.name)}</div>
              <div class="item-sub">${this.escapeHtml([loc.state, loc.country].filter(Boolean).join(", "))}</div>
            </div>
          </li>
        `).join("");

        dropdown.style.display = "block";

        // Click listeners on items
        dropdown.querySelectorAll(".dropdown-item:not(.dropdown-empty)").forEach(itemEl => {
          itemEl.addEventListener("click", () => {
            const data = JSON.parse(decodeURIComponent(itemEl.getAttribute("data-val")));
            dropdown.style.display = "none";
            onSelect(data);
          });
        });
      }, 250);
    });
  }

  markLocationVerified(isVerified, formattedLocation = "") {
    this.isLocationVerified = isVerified;
    if (isVerified) {
      this.regVerifyStatusBadge.textContent = "✓ Verified via API";
      this.regVerifyStatusBadge.style.backgroundColor = "#ecfdf5";
      this.regVerifyStatusBadge.style.color = "#047857";
      this.regVerifyStatusBadge.style.borderColor = "#a7f3d0";
    } else {
      this.regVerifyStatusBadge.textContent = "Unverified";
      this.regVerifyStatusBadge.style.backgroundColor = "#fffbeb";
      this.regVerifyStatusBadge.style.color = "#b45309";
      this.regVerifyStatusBadge.style.borderColor = "#fde68a";
    }
  }

  // ============================================================================
  // Search & Filter Controller ("Donors stay hidden until you search")
  // ============================================================================
  handleFilterChange() {
    const keyword = this.searchInput.value.trim().toLowerCase();
    const blood = this.bloodGroupFilter.value;
    const location = this.locationFilter.value.trim().toLowerCase();
    const status = this.statusFilter.value;

    const hasAnyFilter = Boolean(keyword || blood || location || status);

    // Initial state matching photo: If no search filters, donors stay hidden!
    if (!hasAnyFilter) {
      this.noSearchPlaceholder.style.display = "flex";
      this.donorsGrid.style.display = "none";
      this.emptySearchState.style.display = "none";
      this.filterStatusText.innerHTML = "Enter a search filter above to view matching donors";
      return;
    }

    // Filter matching donors in memory
    const matches = this.donors.filter(d => {
      const matchKeyword = !keyword || 
        d.name.toLowerCase().includes(keyword) || 
        d.id.toLowerCase().includes(keyword) ||
        d.location.toLowerCase().includes(keyword);

      const matchBlood = !blood || d.bloodGroup === blood;
      const matchLoc = !location || d.location.toLowerCase().includes(location);
      const matchStatus = !status || d.status === status;

      return matchKeyword && matchBlood && matchLoc && matchStatus;
    });

    // Hide placeholder
    this.noSearchPlaceholder.style.display = "none";

    // Update status text
    let statusMsg = `Showing <strong>${matches.length}</strong> of <strong>${this.donors.length}</strong> registered donors`;
    if (keyword) {
      statusMsg += ` <span class="filter-active-badge">Search: "${this.escapeHtml(keyword)}"</span>`;
    }
    if (blood) {
      statusMsg += ` <span class="filter-active-badge">Blood: ${blood}</span>`;
    }
    if (location) {
      statusMsg += ` <span class="filter-active-badge">City: "${this.escapeHtml(location)}"</span>`;
    }
    this.filterStatusText.innerHTML = statusMsg;

    if (matches.length === 0) {
      this.donorsGrid.style.display = "none";
      this.emptySearchState.style.display = "block";
    } else {
      this.emptySearchState.style.display = "none";
      this.renderDonorGrid(matches);
      this.donorsGrid.style.display = "grid";
    }
  }

  renderDonorGrid(donorsList) {
    this.donorsGrid.innerHTML = donorsList.map(donor => `
      <article class="donor-card" data-id="${donor.id}">
        <div>
          <div class="card-head">
            <div class="blood-type-badge">${this.escapeHtml(donor.bloodGroup)}</div>
            <span class="donor-status-pill ${donor.status === 'Available' ? 'available' : 'unavailable'}">
              ${donor.status}
            </span>
          </div>

          <h4 class="donor-card-name">${this.escapeHtml(donor.name)}</h4>

          <div class="donor-info-list">
            <div class="info-row">
              <span class="info-row-icon">🎂</span>
              <span>Age: <strong>${donor.age} yrs</strong> • ID: <strong>${donor.id}</strong></span>
            </div>
            <div class="info-row">
              <span class="info-row-icon">📍</span>
              <span>${this.escapeHtml(donor.location)}</span>
            </div>
            <div class="info-row info-phone">
              <span class="info-row-icon">📞</span>
              <a href="tel:${donor.phone}">${this.escapeHtml(donor.phone)}</a>
            </div>            <div class="info-row">
              <span class="info-row-icon">📅</span>
              <span>Registered: ${donor.registeredDate}</span>
            </div>
          </div>
        </div>

        <div class="donor-card-actions">
          <button class="btn-donor-action" onclick="window.app.toggleDonorStatus('${donor.id}')">
            <span>⚡</span> Toggle Status
          </button>
          <button class="btn-donor-action" onclick="window.app.deleteDonor('${donor.id}')">
            <span>🗑️</span> Delete
          </button>
        </div>
      </article>
    `).join("");
  }

  resetFilters() {
    this.searchInput.value = "";
    this.bloodGroupFilter.value = "";
    this.locationFilter.value = "";
    this.statusFilter.value = "";
    this.handleFilterChange();
    this.showToast("Filters reset. Donors hidden until search.", "default");
  }

  updateHeaderCount() {
    if (this.isOfflineData) {
      this.headerDonorsCount.textContent = `${this.donors.length} cached donors (offline)`;
    } else if (this.donors.length) {
      this.headerDonorsCount.textContent = `${this.donors.length} donors available`;
    } else {
      this.headerDonorsCount.textContent = "Donor records unavailable";
    }
  }

  // ============================================================================
  // Inline Donor Registration (with External API Location Verification)
  // ============================================================================
  async handleRegistration(e) {
    e.preventDefault();

    const fullName = this.regFullName.value.trim();
    const bloodGroup = this.regBloodGroup.value;
    const age = parseInt(this.regAge.value, 10);
    let locationInput = this.regLocation.value.trim();
    const phone = this.regPhone.value.trim();
    const isAvailable = this.regAvailableCheckbox.checked;

    if (!fullName || !bloodGroup || isNaN(age) || !locationInput || !phone) {
      this.showToast("Please complete all required fields.", "default");
      return;
    }

    // Verify location against external API if not already verified via dropdown
    if (!this.isLocationVerified) {
      this.regLocationSpinner.style.display = "inline-block";
      this.showToast("Verifying location with external API...", "default");

      const verification = await LocationService.verifyLocation(locationInput);
      this.regLocationSpinner.style.display = "none";

      if (verification.valid) {
        locationInput = verification.standardized;
        this.regLocation.value = locationInput;
        this.markLocationVerified(true, locationInput);
      } else {
        this.markLocationVerified(false);
        this.showToast("⚠️ Could not verify location via external API. Please pick a recognized city.", "default");
        return;
      }
    }

    // Send registration to the backend. The backend generates the donor ID.
    const donorPayload = {
      name: fullName,
      bloodGroup,
      age,
      location: locationInput,
      phone,
      status: isAvailable ? "Available" : "Unavailable"
    };

    try {
      await ApiService.registerDonor(donorPayload);
      await this.refreshDonors();

      this.inlineRegisterForm.reset();
      this.regAvailableCheckbox.checked = true;
      this.markLocationVerified(false);
      this.showToast(`${fullName} (${bloodGroup}) registered successfully.`, "success");
      this.searchInput.value = fullName;
      this.handleFilterChange();
    }  catch (error) {
        console.error("Donor registration failed:", error);
        this.showToast(`Registration failed: ${error.message}`, "default");
    }
  }

  async deleteDonor(id) {
    const donor = this.donors.find(d => d.id === id);
    try {
      await ApiService.deleteDonor(id);
      await this.refreshDonors();
      this.handleFilterChange();
      this.showToast(`Removed donor ${donor ? donor.name : "record"}.`, "default");
    } catch (error) {
      console.error("Donor deletion failed:", error);
      this.showToast("Could not delete donor. The database may be offline.", "default");
    }
  }

  async toggleDonorStatus(id) {
    const donor = this.donors.find(d => d.id === id);
    if (!donor) return;
    const nextStatus = donor.status === "Available" ? "Unavailable" : "Available";
    try {
      await ApiService.updateDonor(id, { status: nextStatus });
      await this.refreshDonors();
      this.handleFilterChange();
      this.showToast(`${donor.name} status updated to ${nextStatus}.`, "success");
    } catch (error) {
      console.error("Donor status update failed:", error);
      this.showToast("Could not update status. Please reconnect and try again.", "default");
    }
  }

  // ============================================================================
  // Emergency Blood Request Feature
  // ============================================================================
  async openEmergencyModal() {
    this.emergencyModal.classList.add("active");
    this.emergencyModal.setAttribute("aria-hidden", "false");
    this.compatMatchesBadge.textContent = "Refreshing donor records...";
    this.emPatientName.focus();

    // Refresh first for current availability; fall back to IndexedDB when offline.
    await this.refreshDonors().catch(() => {});
    this.updateCompatibilityPreview();
  }

  closeEmergencyModalHandler() {
    this.emergencyModal.classList.remove("active");
    this.emergencyModal.setAttribute("aria-hidden", "true");
    this.emergencyModalForm.reset();
  }

  updateCompatibilityPreview() {
    const reqGroup = this.emBloodGroup.value;
    const city = this.emCity.value.trim().toLowerCase();

    if (!reqGroup) {
      this.compatMatchesBadge.textContent = "Select blood group";
      this.compatDetailsText.textContent = "Compatible donors will appear here when you select a blood group.";
      return;
    }

    const compatibleGroups = BLOOD_COMPATIBILITY[reqGroup] || [reqGroup];
    const compatibleDonors = this.donors.filter(d => {
      const groupMatch = compatibleGroups.includes(d.bloodGroup);
      const isAvailable = d.status === "Available";
      const cityMatch = !city || String(d.location || "").toLowerCase().includes(city);
      return groupMatch && isAvailable && cityMatch;
    });

    this.compatMatchesBadge.textContent = `${compatibleDonors.length} Available Matches Found`;
    const sourceNote = this.isOfflineData
      ? "⚠️ Offline cached records — call to confirm current availability."
      : "Live database results.";
    const donorRows = compatibleDonors.slice(0, 8).map(donor => `
      <div class="emergency-match-row" style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #e2e8f0;">
        <span><strong>${this.escapeHtml(donor.name)}</strong><br><small>${this.escapeHtml(donor.bloodGroup)} · ${this.escapeHtml(donor.location || "")}</small></span>
        <a href="tel:${this.escapeHtml(donor.phone || "")}" style="white-space:nowrap;font-weight:700;">📞 ${this.escapeHtml(donor.phone || "No phone")}</a>
      </div>
    `).join("");

    this.compatDetailsText.innerHTML = `
      <div>Recipient <strong>${this.escapeHtml(reqGroup)}</strong> compatible groups: <strong>${compatibleGroups.join(", ")}</strong>.</div>
      ${city ? `<div style="color:#0284c7;margin-top:4px;">📍 Location: "${this.escapeHtml(city)}"</div>` : ""}
      <small style="display:block;margin-top:6px;">${sourceNote}</small>
      ${compatibleDonors.length ? `<div style="margin-top:8px;">${donorRows}</div>` : `<div style="margin-top:8px;">No matching available donors in the ${this.isOfflineData ? "offline cache" : "current database results"}.</div>`}
      ${compatibleDonors.length > 8 ? `<small>Showing first 8 matches. Use the main search for more.</small>` : ""}
    `;
  }

  async handleEmergencySubmit(e) {
    e.preventDefault();

    const emergencyReq = {
      patient: this.emPatientName.value.trim(),
      bloodGroup: this.emBloodGroup.value,
      units: Number(this.emUnits.value),
      hospital: this.emHospital.value.trim(),
      city: this.emCity.value.trim(),
      urgency: this.emUrgency.value,
      contactPhone: this.emContactPhone.value.trim()
    };

    // Offline search still works, but an actual broadcast requires a server connection.
    if (!navigator.onLine || this.isOfflineData) {
      this.updateCompatibilityPreview();
      this.showToast("Offline: donor details are from the last sync. The emergency request was NOT broadcast.", "emergency");
      return;
    }

    try {
      await ApiService.submitEmergencyRequest(emergencyReq);
      this.closeEmergencyModalHandler();
      this.bloodGroupFilter.value = emergencyReq.bloodGroup;
      if (emergencyReq.city) this.locationFilter.value = emergencyReq.city;
      this.handleFilterChange();
      this.showToast(`Emergency request submitted for ${emergencyReq.patient}.`, "emergency");
    } catch (error) {
      console.error("Emergency request submission failed:", error);
      this.showToast("Request could not be broadcast. Call matching donors directly and contact the hospital.", "emergency");
    }
  }

  // ============================================================================
  // Toast Helper
  // ============================================================================
  showToast(message, type = "default") {
    const toast = document.createElement("div");
    toast.className = `toast-item toast-${type}`;

    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "emergency") icon = "🚨";

    toast.innerHTML = `<span>${icon}</span> <span>${this.escapeHtml(message)}</span>`;
    this.toastStack.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      toast.style.transition = "all 0.2s ease";
      setTimeout(() => toast.remove(), 250);
    }, 3600);
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

// Instantiate application on document ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new PulseConnectApp();
});