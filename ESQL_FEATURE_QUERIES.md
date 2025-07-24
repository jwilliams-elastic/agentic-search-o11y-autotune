# 🔍 ESQL Queries for LTR Feature Data

## 📊 **Your Data Stream**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001 | LIMIT 10
```

## 🎯 **LTR Feature Queries**

### **1. Find All Search Events**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_search"
| SORT `@timestamp` DESC
| LIMIT 10
```

### **2. Find All User Interaction Events**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_user_interactions"
| SORT `@timestamp` DESC
| LIMIT 10
```

### **3. Get Search Events with Key Features**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_search"
| KEEP `@timestamp`, `custom.user.id`, `custom.search.query`, `custom.search.results_count`, `custom.search.ltr_enabled`, `custom.performance.search_time_ms`
| SORT `@timestamp` DESC
| LIMIT 20
```

### **4. Get Interaction Events with Position Data**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_user_interactions"
| KEEP `@timestamp`, `custom.search.interaction.position`, `custom.search.interaction.type`, `custom.agent.conversational_detection`
| SORT `@timestamp` DESC
| LIMIT 20
```

### **5. Find Conversational Interactions**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_user_interactions" 
  AND `custom.agent.conversational_detection` == true
| KEEP `@timestamp`, `custom.search.interaction.position`, `custom.search.interaction.type`
| SORT `@timestamp` DESC
```

### **6. Find LTR-Enabled Searches**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_search" 
  AND `custom.search.ltr_enabled` == true
| KEEP `@timestamp`, `custom.search.query`, `custom.search.results_count`, `custom.performance.search_time_ms`
| SORT `@timestamp` DESC
```

### **7. Count Events by Type**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| STATS event_count = COUNT() BY `custom.event.action`
| SORT event_count DESC
```

### **8. Find Events for Specific User**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.user.id` == "test_user_ltr"
| KEEP `@timestamp`, `custom.event.action`, `custom.search.query`, `custom.search.interaction.position`
| SORT `@timestamp` DESC
```

### **9. Search Performance Analysis**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_search"
| STATS 
    avg_search_time = AVG(`custom.performance.search_time_ms`),
    avg_results = AVG(`custom.search.results_count`),
    total_searches = COUNT()
  BY `custom.search.ltr_enabled`
```

### **10. Position Analysis for Interactions**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_user_interactions"
| STATS interaction_count = COUNT() BY `custom.search.interaction.position`
| SORT `custom.search.interaction.position` ASC
```

### **11. Join Search and Interaction Events**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` IN ("agent_search", "agent_user_interactions")
| KEEP `@timestamp`, `custom.event.action`, `custom.search.session_id`, `custom.search.query`, `custom.search.interaction.position`
| SORT `custom.search.session_id`, `@timestamp`
| LIMIT 50
```

### **12. Recent Activity with All Features**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `@timestamp` >= NOW() - 24 hours
  AND `custom.event.action` IN ("agent_search", "agent_user_interactions")
| KEEP 
    `@timestamp`,
    `custom.event.action`,
    `custom.user.id`,
    `custom.search.session_id`,
    `custom.search.query`,
    `custom.search.results_count`,
    `custom.search.ltr_enabled`,
    `custom.search.interaction.position`,
    `custom.search.interaction.type`,
    `custom.agent.conversational_detection`,
    `custom.performance.search_time_ms`
| SORT `@timestamp` DESC
| LIMIT 100
```

### **13. Template Usage Analysis**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_search"
| STATS 
    search_count = COUNT(),
    avg_results = AVG(`custom.search.results_count`),
    avg_time = AVG(`custom.performance.search_time_ms`)
  BY `custom.search.template_id`
| SORT search_count DESC
```

### **14. Conversational Detection Summary**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` == "agent_user_interactions"
| STATS 
    total_interactions = COUNT(),
    conversational_interactions = COUNT(`custom.agent.conversational_detection`) 
  BY `custom.search.interaction.type`
```

### **15. Training Data Export View**
```sql
FROM .ds-logs-agentic-search-o11y-autotune.events-2025.07.23-000001
| WHERE `custom.event.action` IN ("agent_search", "agent_user_interactions")
| KEEP 
    `custom.search.session_id`,
    `custom.user.id`,
    `custom.event.action`,
    `custom.search.query`,
    `custom.search.results_count`,
    `custom.search.ltr_enabled`,
    `custom.search.template_id`,
    `custom.performance.search_time_ms`,
    `custom.search.interaction.position`,
    `custom.search.interaction.type`,
    `custom.agent.conversational_detection`
| SORT `custom.search.session_id`, `@timestamp`
| LIMIT 1000
```

## 🎯 **Key Fields for LTR Training**

### **Search Events (`agent_search`):**
- `custom.user.id` - User identifier
- `custom.search.session_id` - Session tracking
- `custom.search.query` - Search query text
- `custom.search.results_count` - Number of results
- `custom.search.template_id` - Which search template used
- `custom.search.ltr_enabled` - Whether LTR was enabled
- `custom.performance.search_time_ms` - Search latency
- `custom.performance.elasticsearch_time_ms` - ES processing time

### **Interaction Events (`agent_user_interactions`):**
- `custom.search.interaction.document_id` - Which document
- `custom.search.interaction.position` - Position in results (1-based)
- `custom.search.interaction.type` - Type of interaction
- `custom.agent.conversational_detection` - Boolean flag
- `custom.agent.confidence_score` - Detection confidence

## 🚀 **Pro Tips**

### **Use Backticks for Field Names:**
```sql
-- Correct
WHERE `custom.event.action` == "agent_search"

-- Won't work  
WHERE custom.event.action == "agent_search"
```

### **Filter by Time Range:**
```sql
WHERE `@timestamp` >= NOW() - 1 day
WHERE `@timestamp` >= "2025-07-23T00:00:00Z"
```

### **Combine Multiple Conditions:**
```sql
WHERE `custom.event.action` == "agent_search" 
  AND `custom.search.results_count` > 0
  AND `custom.search.ltr_enabled` == true
```

Your ESQL queries will work perfectly with your unified data stream! 🎉
