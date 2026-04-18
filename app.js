(function initInvoiceApp(root) {
  "use strict";

  var DAY_IN_MS = 24 * 60 * 60 * 1000;

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }

    callback();
  }

  function getLogic() {
    return root.InvoiceLogic || null;
  }

  function getStorage() {
    return root.InvoiceStorage || null;
  }

  function getExport() {
    return root.InvoiceExport || null;
  }

  function toFiniteNumber(value) {
    var logic = getLogic();

    if (logic && typeof logic.parseNumber === "function") {
      return logic.parseNumber(value);
    }

    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function roundCurrency(value) {
    var logic = getLogic();

    if (logic && typeof logic.roundTo === "function") {
      return logic.roundTo(Number(value) || 0, 2);
    }

    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
  }

  function textValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(dateValue, days) {
    var base = dateValue ? new Date(dateValue + "T00:00:00") : new Date();
    base.setTime(base.getTime() + (days * DAY_IN_MS));
    return base.toISOString().slice(0, 10);
  }

  function padNumber(value) {
    return String(value).padStart(2, "0");
  }

  function generateInvoiceNumber(records) {
    var now = new Date();
    var dateStamp = [
      now.getFullYear(),
      padNumber(now.getMonth() + 1),
      padNumber(now.getDate())
    ].join("");
    var minuteStamp = padNumber(now.getHours()) + padNumber(now.getMinutes());
    var sequence = String((records || []).length + 1).padStart(3, "0");

    return "INV-" + dateStamp + "-" + minuteStamp + "-" + sequence;
  }

  function formatCurrency(value, currency) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (e) {
    return "₹ " + (Number(value) || 0).toFixed(2);
  }

  }

  function formatDate(value) {
    var logic = getLogic();

    if (logic && typeof logic.formatDueDate === "function") {
      return logic.formatDueDate(value, {
        locale: root.navigator && root.navigator.language ? root.navigator.language : "en-US"
      });
    }

    return textValue(value);
  }

  function splitAddress(value) {
    var lines = String(value || "")
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);

    return {
      address1: lines[0] || "",
      address2: lines[1] || "",
      city: lines[2] || "",
      country: lines[3] || ""
    };
  }

  function combineAddress(party) {
    var lines = [];

    if (!party || typeof party !== "object") {
      return "";
    }

    if (party.address1) {
      lines.push(party.address1);
    }
    if (party.address2) {
      lines.push(party.address2);
    }

    var cityLine = [party.city, party.region, party.postalCode].filter(Boolean).join(", ");
    if (cityLine) {
      lines.push(cityLine);
    }

    if (party.country) {
      lines.push(party.country);
    }

    return lines.join("\n");
  }

  function createDefaultItem() {
    return {
      description: "",
      quantity: 1,
      rate: 0
    };
  }

  function getRecords(storage) {
    if (!storage || typeof storage.list !== "function") {
      return [];
    }

    try {
      return storage.list() || [];
    } catch (error) {
      return [];
    }
  }

  function getRecord(storage, id) {
    if (!storage || typeof storage.get !== "function") {
      return null;
    }

    try {
      return storage.get(id);
    } catch (error) {
      return null;
    }
  }

  function normalizeItem(item) {
    var source = item || {};
    var quantity = source.quantity == null || source.quantity === "" ? 0 : toFiniteNumber(source.quantity);
    var rate = source.rate == null || source.rate === "" ? 0 : toFiniteNumber(source.rate);

    return {
      description: textValue(source.description),
      quantity: Number.isFinite(quantity) ? quantity : source.quantity,
      rate: Number.isFinite(rate) ? rate : source.rate
    };
  }

  function normalizeInvoiceRecord(record, defaults) {
    var source = record || {};
    var billFrom = source.billFrom || source.company || {};
    var billTo = source.billTo || source.customer || source.client || {};
    var discount = source.discount || {};
    var items = Array.isArray(source.items) ? source.items : (Array.isArray(source.lineItems) ? source.lineItems : []);

    return {
      id: source.id || "",
      createdAt: source.createdAt || "",
      updatedAt: source.updatedAt || "",
      invoiceNumber: textValue(source.invoiceNumber) || generateInvoiceNumber(getRecords(getStorage())),
      issueDate: textValue(source.issueDate) || todayIso(),
      dueDate: textValue(source.dueDate) || addDays(todayIso(), 14),
      purchaseOrder: textValue(source.purchaseOrder),
      currency: textValue(source.currency) || defaults.currency || "USD",
      companyName: textValue(source.companyName || billFrom.name || defaults.companyName),
      companyEmail: textValue(source.companyEmail || billFrom.email || defaults.companyEmail),
      companyPhone: textValue(source.companyPhone || billFrom.phone || defaults.companyPhone),
      companyAddress: textValue(source.companyAddress || combineAddress(billFrom) || defaults.companyAddress),
      clientName: textValue(source.clientName || source.customerName || billTo.name),
      clientEmail: textValue(source.clientEmail || billTo.email),
      clientPhone: textValue(source.clientPhone || billTo.phone),
      clientAddress: textValue(source.clientAddress || combineAddress(billTo)),
      notes: textValue(source.notes || defaults.notes),
      taxRate: source.taxRate == null || source.taxRate === "" ? String(defaults.taxRate) : String(source.taxRate),
      discountType: textValue(discount.type) === "percent" ? "percent" : "amount",
      discountValue: source.discountValue != null && source.discountValue !== ""
        ? String(source.discountValue)
        : (discount.value != null && discount.value !== "" ? String(discount.value) : "0"),
      items: items.length ? items.map(normalizeItem) : [createDefaultItem()]
    };
  }

  function createDraft(app) {
    var storage = app.storage;
    var base = typeof storage.createDraft === "function"
      ? storage.createDraft({
          invoiceNumber: generateInvoiceNumber(getRecords(storage)),
          issueDate: todayIso(),
          dueDate: addDays(todayIso(), 14),
          currency: app.defaults.currency,
          companyName: app.defaults.companyName,
          companyEmail: app.defaults.companyEmail,
          companyPhone: app.defaults.companyPhone,
          companyAddress: app.defaults.companyAddress,
          notes: app.defaults.notes,
          taxRate: app.defaults.taxRate,
          discount: {
            type: "amount",
            value: 0
          },
          items: [createDefaultItem()]
        })
      : {};

    return normalizeInvoiceRecord(base, app.defaults);
  }

  function setFieldValue(input, value) {
    if (input) {
      input.value = value == null ? "" : value;
    }
  }

  function buildParty(name, email, phone, address) {
    var split = splitAddress(address);

    return {
      name: textValue(name),
      email: textValue(email),
      phone: textValue(phone),
      address1: split.address1,
      address2: split.address2,
      city: split.city,
      country: split.country
    };
  }

  function updateFieldPaths(app) {
    var rows = app.refs.lineItems.querySelectorAll("[data-line-item-row]");

    rows.forEach(function (row, index) {
      var description = row.querySelector("[data-item-field=\"description\"]");
      var quantity = row.querySelector("[data-item-field=\"quantity\"]");
      var rate = row.querySelector("[data-item-field=\"rate\"]");

      if (description) {
        description.setAttribute("data-field-path", "items[" + index + "].description");
      }
      if (quantity) {
        quantity.setAttribute("data-field-path", "items[" + index + "].quantity");
      }
      if (rate) {
        rate.setAttribute("data-field-path", "items[" + index + "].rate");
      }
    });
  }

  function renderLineItems(app, items) {
    var template = app.refs.lineItemTemplate;
    var list = app.refs.lineItems;
    var sourceItems = Array.isArray(items) && items.length ? items : [createDefaultItem()];

    list.innerHTML = "";

    sourceItems.forEach(function (item) {
      var fragment = template.content.firstElementChild.cloneNode(true);
      var description = fragment.querySelector("[data-item-field=\"description\"]");
      var quantity = fragment.querySelector("[data-item-field=\"quantity\"]");
      var rate = fragment.querySelector("[data-item-field=\"rate\"]");

      setFieldValue(description, item.description);
      setFieldValue(quantity, item.quantity);
      setFieldValue(rate, item.rate);

      list.appendChild(fragment);
    });

    updateFieldPaths(app);
    updateLineItemAmounts(app);
  }

  function collectLineItems(app) {
    var rows = app.refs.lineItems.querySelectorAll("[data-line-item-row]");

    return Array.prototype.map.call(rows, function (row) {
      var descriptionInput = row.querySelector("[data-item-field=\"description\"]");
      var quantityInput = row.querySelector("[data-item-field=\"quantity\"]");
      var rateInput = row.querySelector("[data-item-field=\"rate\"]");

      var quantityValue = quantityInput ? quantityInput.value : "";
      var rateValue = rateInput ? rateInput.value : "";
      var quantity = quantityValue === "" ? 0 : toFiniteNumber(quantityValue);
      var rate = rateValue === "" ? 0 : toFiniteNumber(rateValue);

      return {
        description: descriptionInput ? textValue(descriptionInput.value) : "",
        quantity: Number.isFinite(quantity) ? quantity : quantityValue,
        rate: Number.isFinite(rate) ? rate : rateValue
      };
    });
  }

  function collectInvoice(app) {
    var items = collectLineItems(app);
    var discountValue = app.refs.discountValue.value === "" ? 0 : toFiniteNumber(app.refs.discountValue.value);
    var taxRate = app.refs.taxRate.value === "" ? 0 : toFiniteNumber(app.refs.taxRate.value);

    var invoice = {
      id: app.state.currentId || "",
      createdAt: app.state.createdAt || "",
      updatedAt: app.state.updatedAt || "",
      invoiceNumber: textValue(app.refs.invoiceNumber.value),
      issueDate: textValue(app.refs.issueDate.value),
      dueDate: textValue(app.refs.dueDate.value),
      purchaseOrder: textValue(app.refs.purchaseOrder.value),
      currency: textValue(app.refs.currency.value) || app.defaults.currency || "USD",
      companyName: textValue(app.refs.companyName.value),
      companyEmail: textValue(app.refs.companyEmail.value),
      companyPhone: textValue(app.refs.companyPhone.value),
      companyAddress: textValue(app.refs.companyAddress.value),
      clientName: textValue(app.refs.clientName.value),
      customerName: textValue(app.refs.clientName.value),
      clientEmail: textValue(app.refs.clientEmail.value),
      clientPhone: textValue(app.refs.clientPhone.value),
      clientAddress: textValue(app.refs.clientAddress.value),
      billFrom: buildParty(
        app.refs.companyName.value,
        app.refs.companyEmail.value,
        app.refs.companyPhone.value,
        app.refs.companyAddress.value
      ),
      billTo: buildParty(
        app.refs.clientName.value,
        app.refs.clientEmail.value,
        app.refs.clientPhone.value,
        app.refs.clientAddress.value
      ),
      company: buildParty(
        app.refs.companyName.value,
        app.refs.companyEmail.value,
        app.refs.companyPhone.value,
        app.refs.companyAddress.value
      ),
      customer: buildParty(
        app.refs.clientName.value,
        app.refs.clientEmail.value,
        app.refs.clientPhone.value,
        app.refs.clientAddress.value
      ),
      notes: textValue(app.refs.notes.value),
      status: "draft",
      discount: {
        type: app.refs.discountType.value === "percent" ? "percent" : "amount",
        value: Number.isFinite(discountValue) ? discountValue : app.refs.discountValue.value
      },
      discountValue: Number.isFinite(discountValue) ? discountValue : app.refs.discountValue.value,
      taxRate: Number.isFinite(taxRate) ? taxRate : app.refs.taxRate.value,
      items: items
    };

    var logic = getLogic();
    var totals = logic && typeof logic.calculateInvoice === "function"
      ? logic.calculateInvoice(invoice)
      : {
          subtotal: 0,
          discountAmount: 0,
          taxAmount: 0,
          grandTotal: 0,
          taxableAmount: 0
        };

    invoice.lineItems = items;
    invoice.subtotal = totals.subtotal;
    invoice.discountAmount = totals.discountAmount;
    invoice.taxAmount = totals.taxAmount;
    invoice.total = totals.grandTotal;
    invoice.totals = {
      subtotal: totals.subtotal,
      discount: totals.discountAmount,
      tax: totals.taxAmount,
      total: totals.grandTotal,
      taxableAmount: totals.taxableAmount
    };

    return {
      invoice: invoice,
      totals: totals
    };
  }

  function updateLineItemAmounts(app) {
    var currency = app.refs.currency.value || app.defaults.currency || "USD";
    var rows = app.refs.lineItems.querySelectorAll("[data-line-item-row]");

    rows.forEach(function (row) {
      var quantity = toFiniteNumber(row.querySelector("[data-item-field=\"quantity\"]").value);
      var rate = toFiniteNumber(row.querySelector("[data-item-field=\"rate\"]").value);
      var totalNode = row.querySelector("[data-line-total]");
      var amount = Number.isFinite(quantity) && Number.isFinite(rate) ? quantity * rate : NaN;

      totalNode.textContent = Number.isFinite(amount) ? formatCurrency(amount, currency) : "-";
    });
  }

  function setSummaryValue(app, key, value) {
    var node = app.root.querySelector("[data-summary=\"" + key + "\"]");
    if (node) {
      node.textContent = value;
    }
  }

  function setFeedback(app, message, tone) {
    app.refs.feedback.textContent = message;
    app.refs.feedback.setAttribute("data-tone", tone || "neutral");
  }

  function clearValidation(app) {
    app.root.querySelectorAll(".is-invalid").forEach(function (input) {
      input.classList.remove("is-invalid");
    });
    app.refs.validationList.innerHTML = "";
  }

  function findFieldByPath(app, field) {
    if (field === "customerName") {
      return app.refs.clientName;
    }

    var candidates = app.root.querySelectorAll("[data-field], [data-field-path]");
    var match = null;

    candidates.forEach(function (candidate) {
      if (match) {
        return;
      }

      if (candidate.getAttribute("data-field") === field || candidate.getAttribute("data-field-path") === field) {
        match = candidate;
      }
    });

    return match;
  }

  function showValidation(app, errors) {
    clearValidation(app);

    errors.forEach(function (error) {
      var item = document.createElement("li");
      item.textContent = error.message;
      app.refs.validationList.appendChild(item);

      var field = findFieldByPath(app, error.field);
      if (field) {
        field.classList.add("is-invalid");
      }
    });

    if (errors.length) {
      var firstField = findFieldByPath(app, errors[0].field);
      if (firstField && typeof firstField.focus === "function") {
        firstField.focus();
      }
      setFeedback(app, "Please fix the highlighted fields before continuing.", "danger");
    }
  }

  function renderSavedInvoices(app) {
    var records = getRecords(app.storage);
    var container = app.refs.savedList;

    container.innerHTML = "";

    if (!records.length) {
      var empty = document.createElement("div");
      empty.className = "invoice-app__empty";
      empty.textContent = "Saved invoices will appear here after you store the first one in this browser.";
      container.appendChild(empty);
    } else {
      records.forEach(function (record) {
        var item = document.createElement("article");
        item.className = "invoice-app__saved-item" + (record.id === app.state.currentId ? " is-active" : "");

        var top = document.createElement("div");
        top.className = "invoice-app__saved-top";

        var titleWrap = document.createElement("div");
        var title = document.createElement("h3");
        var meta = document.createElement("div");
        title.className = "invoice-app__saved-title";
        meta.className = "invoice-app__saved-meta";
        title.textContent = record.invoiceNumber || "Untitled invoice";
        meta.textContent = "Updated " + formatDate(record.updatedAt || record.createdAt || "");
        titleWrap.appendChild(title);
        titleWrap.appendChild(meta);

        var status = document.createElement("span");
        status.className = "invoice-app__pill";
        status.textContent = record.status || "draft";

        top.appendChild(titleWrap);
        top.appendChild(status);

        var bottom = document.createElement("div");
        bottom.className = "invoice-app__saved-bottom";

        var details = document.createElement("div");
        var client = document.createElement("div");
        var total = document.createElement("div");
        client.className = "invoice-app__saved-client";
        total.className = "invoice-app__saved-total";
        client.textContent = record.clientName || record.customerName || (record.billTo && record.billTo.name) || "No client yet";
        total.textContent = "Total " + formatCurrency(record.total || (record.totals && record.totals.total) || 0, record.currency || app.defaults.currency);
        details.appendChild(client);
        details.appendChild(total);

        var actions = document.createElement("div");
        actions.className = "invoice-app__saved-actions";

        var loadButton = document.createElement("button");
        loadButton.type = "button";
        loadButton.className = "invoice-app__button invoice-app__button--secondary";
        loadButton.setAttribute("data-action", "load-invoice");
        loadButton.setAttribute("data-invoice-id", record.id);
        loadButton.textContent = "Load";

        var deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "invoice-app__button invoice-app__button--ghost";
        deleteButton.setAttribute("data-action", "delete-invoice");
        deleteButton.setAttribute("data-invoice-id", record.id);
        deleteButton.textContent = "Delete";

        actions.appendChild(loadButton);
        actions.appendChild(deleteButton);

        bottom.appendChild(details);
        bottom.appendChild(actions);

        item.appendChild(top);
        item.appendChild(bottom);
        container.appendChild(item);
      });
    }

    setSummaryValue(app, "saved-count", String(records.length));
    setSummaryValue(app, "saved-meta", records.length ? "Stored locally on this device" : "Nothing saved yet");
  }

  function renderSummary(app, context) {
    var invoice = context.invoice;
    var totals = context.totals;
    var records = getRecords(app.storage);
    var lastSaved = records[0];

    setSummaryValue(app, "subtotal", formatCurrency(totals.subtotal || 0, invoice.currency));
    setSummaryValue(app, "tax", formatCurrency(totals.taxAmount || 0, invoice.currency));
    setSummaryValue(app, "grand-total", formatCurrency(totals.grandTotal || 0, invoice.currency));
    setSummaryValue(app, "due-meta", invoice.invoiceNumber ? invoice.invoiceNumber : "Draft invoice");
    setSummaryValue(app, "saved-count", String(records.length));
    setSummaryValue(app, "saved-meta", lastSaved ? "Last updated " + formatDate(lastSaved.updatedAt || lastSaved.createdAt) : "Nothing saved yet");

    app.refs.subtotal.textContent = formatCurrency(totals.subtotal || 0, invoice.currency);
    app.refs.discountAmount.textContent = formatCurrency(totals.discountAmount || 0, invoice.currency);
    app.refs.taxAmount.textContent = formatCurrency(totals.taxAmount || 0, invoice.currency);
    app.refs.totalAmount.textContent = formatCurrency(totals.grandTotal || 0, invoice.currency);
  }

  function refresh(app) {
    clearValidation(app);
    updateLineItemAmounts(app);
    renderSummary(app, collectInvoice(app));
  }

  function populateForm(app, invoice) {
    var normalized = normalizeInvoiceRecord(invoice, app.defaults);

    app.state.currentId = normalized.id || "";
    app.state.createdAt = normalized.createdAt || "";
    app.state.updatedAt = normalized.updatedAt || "";

    setFieldValue(app.refs.invoiceNumber, normalized.invoiceNumber);
    setFieldValue(app.refs.issueDate, normalized.issueDate);
    setFieldValue(app.refs.dueDate, normalized.dueDate);
    setFieldValue(app.refs.purchaseOrder, normalized.purchaseOrder);
    setFieldValue(app.refs.currency, normalized.currency);
    setFieldValue(app.refs.companyName, normalized.companyName);
    setFieldValue(app.refs.companyEmail, normalized.companyEmail);
    setFieldValue(app.refs.companyPhone, normalized.companyPhone);
    setFieldValue(app.refs.companyAddress, normalized.companyAddress);
    setFieldValue(app.refs.clientName, normalized.clientName);
    setFieldValue(app.refs.clientEmail, normalized.clientEmail);
    setFieldValue(app.refs.clientPhone, normalized.clientPhone);
    setFieldValue(app.refs.clientAddress, normalized.clientAddress);
    setFieldValue(app.refs.discountType, normalized.discountType);
    setFieldValue(app.refs.discountValue, normalized.discountValue);
    setFieldValue(app.refs.taxRate, normalized.taxRate);
    setFieldValue(app.refs.notes, normalized.notes);

    renderLineItems(app, normalized.items);
    renderSavedInvoices(app);
    refresh(app);
  }

  function createValidationContext(app) {
    var logic = getLogic();
    var payload = collectInvoice(app);
    var validation = logic && typeof logic.validateInvoice === "function"
      ? logic.validateInvoice(payload.invoice)
      : { valid: true, errors: [] };

    return {
      payload: payload,
      validation: validation
    };
  }

  function saveInvoice(app) {
    var context = createValidationContext(app);

    if (!context.validation.valid) {
      showValidation(app, context.validation.errors);
      return;
    }

    var saved = app.storage.save(context.payload.invoice);

    if (!saved) {
      setFeedback(app, "Invoice could not be saved in local storage on this device.", "warning");
      return;
    }

    app.state.currentId = saved.id || "";
    app.state.createdAt = saved.createdAt || "";
    app.state.updatedAt = saved.updatedAt || "";
    renderSavedInvoices(app);
    refresh(app);
    setFeedback(app, "Invoice saved locally and ready to reopen anytime in this browser.", "success");
  }

  function exportInvoice(app) {
    var context = createValidationContext(app);

    if (!context.validation.valid) {
      showValidation(app, context.validation.errors);
      return;
    }

    if (!app.exporter || typeof app.exporter.downloadPdf !== "function") {
      setFeedback(app, "PDF export is unavailable because the export module did not load.", "warning");
      return;
    }

    app.exporter.downloadPdf(context.payload.invoice, {
      filename: (context.payload.invoice.invoiceNumber || "invoice") + ".pdf"
    });

    refresh(app);
    setFeedback(app, "PDF downloaded with the current invoice details.", "success");
  }

  function addLineItem(app) {
    var current = collectInvoice(app).invoice.items;
    current.push(createDefaultItem());
    renderLineItems(app, current);
    refresh(app);
  }

  function removeLineItem(app, button) {
    var rows = Array.prototype.slice.call(app.refs.lineItems.querySelectorAll("[data-line-item-row]"));

    if (rows.length <= 1) {
      var onlyRow = rows[0];
      if (onlyRow) {
        onlyRow.querySelector("[data-item-field=\"description\"]").value = "";
        onlyRow.querySelector("[data-item-field=\"quantity\"]").value = 1;
        onlyRow.querySelector("[data-item-field=\"rate\"]").value = 0;
      }
      refresh(app);
      return;
    }

    var row = button.closest("[data-line-item-row]");
    if (row && row.parentNode) {
      row.parentNode.removeChild(row);
    }

    updateFieldPaths(app);
    refresh(app);
  }

  function loadInvoice(app, id) {
    var record = getRecord(app.storage, id);

    if (!record) {
      setFeedback(app, "That invoice is no longer available in local storage.", "warning");
      renderSavedInvoices(app);
      return;
    }

    populateForm(app, record);
    setFeedback(app, "Loaded saved invoice " + (record.invoiceNumber || id) + ".", "success");
  }

  function deleteInvoice(app, id) {
    if (!app.storage || typeof app.storage.remove !== "function") {
      return;
    }

    app.storage.remove(id);

    if (app.state.currentId === id) {
      populateForm(app, createDraft(app));
    } else {
      renderSavedInvoices(app);
      refresh(app);
    }

    setFeedback(app, "Saved invoice removed from local storage.", "warning");
  }

  function startNewInvoice(app) {
    populateForm(app, createDraft(app));
    setFeedback(app, "Fresh invoice draft ready.", "neutral");
  }

  function bindEvents(app) {
    app.root.addEventListener("click", function (event) {
      var actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) {
        return;
      }

      var action = actionTarget.getAttribute("data-action");

      if (action === "add-item") {
        addLineItem(app);
      } else if (action === "remove-item") {
        removeLineItem(app, actionTarget);
      } else if (action === "save-invoice") {
        saveInvoice(app);
      } else if (action === "export-pdf") {
        exportInvoice(app);
      } else if (action === "new-invoice") {
        startNewInvoice(app);
      } else if (action === "load-invoice") {
        loadInvoice(app, actionTarget.getAttribute("data-invoice-id"));
      } else if (action === "delete-invoice") {
        deleteInvoice(app, actionTarget.getAttribute("data-invoice-id"));
      }
    });

    app.root.addEventListener("input", function () {
      refresh(app);
    });

    app.root.addEventListener("change", function () {
      refresh(app);
    });
  }

  function createApp(rootNode) {
    var storage = getStorage();
    var logic = getLogic();
    var exporter = getExport();

    if (!storage || !logic) {
      return null;
    }

    return {
      root: rootNode,
      storage: storage,
      logic: logic,
      exporter: exporter,
      defaults: {
        companyName: rootNode.getAttribute("data-default-company-name") || "",
        companyEmail: rootNode.getAttribute("data-default-company-email") || "",
        companyPhone: rootNode.getAttribute("data-default-company-phone") || "",
        companyAddress: rootNode.getAttribute("data-default-company-address") || "",
        currency: rootNode.getAttribute("data-default-currency") || "USD",
        taxRate: Number(rootNode.getAttribute("data-default-tax-rate")) || 0,
        notes: rootNode.getAttribute("data-default-notes") || ""
      },
      state: {
        currentId: "",
        createdAt: "",
        updatedAt: ""
      },
      refs: {
        invoiceNumber: rootNode.querySelector("[data-field=\"invoiceNumber\"]"),
        issueDate: rootNode.querySelector("[data-field=\"issueDate\"]"),
        dueDate: rootNode.querySelector("[data-field=\"dueDate\"]"),
        purchaseOrder: rootNode.querySelector("[data-field=\"purchaseOrder\"]"),
        currency: rootNode.querySelector("[data-field=\"currency\"]"),
        companyName: rootNode.querySelector("[data-field=\"companyName\"]"),
        companyEmail: rootNode.querySelector("[data-field=\"companyEmail\"]"),
        companyPhone: rootNode.querySelector("[data-field=\"companyPhone\"]"),
        companyAddress: rootNode.querySelector("[data-field=\"companyAddress\"]"),
        clientName: rootNode.querySelector("[data-field=\"clientName\"]"),
        clientEmail: rootNode.querySelector("[data-field=\"clientEmail\"]"),
        clientPhone: rootNode.querySelector("[data-field=\"clientPhone\"]"),
        clientAddress: rootNode.querySelector("[data-field=\"clientAddress\"]"),
        discountType: rootNode.querySelector("[data-field=\"discountType\"]"),
        discountValue: rootNode.querySelector("[data-field=\"discountValue\"]"),
        taxRate: rootNode.querySelector("[data-field=\"taxRate\"]"),
        notes: rootNode.querySelector("[data-field=\"notes\"]"),
        lineItems: rootNode.querySelector("[data-line-items]"),
        lineItemTemplate: rootNode.querySelector("[data-line-item-template]"),
        subtotal: rootNode.querySelector("[data-total=\"subtotal\"]"),
        discountAmount: rootNode.querySelector("[data-total=\"discount\"]"),
        taxAmount: rootNode.querySelector("[data-total=\"tax\"]"),
        totalAmount: rootNode.querySelector("[data-total=\"grandTotal\"]"),
        feedback: rootNode.querySelector("[data-feedback]"),
        validationList: rootNode.querySelector("[data-validation-list]"),
        savedList: rootNode.querySelector("[data-saved-list]")
      }
    };
  }

  onReady(function () {
    var roots = document.querySelectorAll("[data-invoice-app]");

    roots.forEach(function (rootNode) {
      var app = createApp(rootNode);

      if (!app) {
        return;
      }

      bindEvents(app);
      populateForm(app, createDraft(app));
      setFeedback(app, "Everything updates live as you edit. Save to store invoices locally in this browser.", "neutral");
    });
  });
})(window);
