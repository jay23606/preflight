<%@ Page Language="C#" %>
<%@ Import Namespace="System.Data" %>
<%@ Import Namespace="App.Domain.Orders" %>
<script runat="server">
  protected void Page_Load(object sender, EventArgs e)
  {
      Response.Write(OrderService.Describe(Request.QueryString["id"]));
  }
</script>
<html><body><h1>Order lookup</h1></body></html>
